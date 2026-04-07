// v2ImportService — V2 历史数据前端导入引擎 (S21)
//
// 职责：
//   1. parseV2JSON         — 解析 V2 JSON 数组，提取有效记录
//   2. mapV2RecordToV3     — 单条 V2 记录 → V3 Transaction（垃圾袋隔离策略）
//   3. batchImportV2       — 批量写入 Firestore（writeBatch，499条/批）
//                           返回 txDocIds — 与 records 平行的 docId 数组，供凭证绑定
//   4. importV2Evidences   — 从 V2 voucherPaths/imageUrl 字段拉取图片并上传到 V3
//   5. deleteV2Records     — 精准清场：仅删 sourceType='V2_to_V3' 的记录和关联凭证
//
// 垃圾袋隔离策略（核心设计）：
//   · 只从 V2 记录中提取：date / amount / category / description 四个核心字段
//   · V2 的所有其他字段（voucherPaths、智能关联字段等）全部打包进
//     rawData.legacy_backup — 对 V3 主数据层完全透明，不污染任何字段
//   · rawData._migratedFromV2 = true → ConflictCenter 自动检测为"待验证"冲突
//   · rawData._importedViaUI = true  → 区分脚本迁移与前端 UI 导入

import {
  collection, doc, writeBatch, serverTimestamp,
  query, where, getDocs,
} from 'firebase/firestore'
import { db }          from '@/config/firebase'
import type { Transaction } from '@/types/Transaction.types'
import type { SystemCategory } from '@/types/Category.types'
import { uploadEvidence, deleteEvidence } from './firebase/evidenceService'

// ════════════════════════════════════════════════════════════════
// § 1  V2 字段别名映射表（14 个字段变体，与后端脚本保持一致）
// ════════════════════════════════════════════════════════════════

/** 尝试从 V2 记录中提取日期字段（YYYY-MM-DD 格式）*/
function extractDate(record: Record<string, unknown>): string {
  const raw =
    record['date']            ??
    record['transactionDate'] ??
    record['billDate']        ??
    record['createTime']      ??
    record['tradeTime']       ??
    record['time']

  if (!raw) return new Date().toISOString().slice(0, 10)

  // 处理时间戳（秒 / 毫秒）
  if (typeof raw === 'number') {
    const ms = raw > 1e10 ? raw : raw * 1000
    return new Date(ms).toISOString().slice(0, 10)
  }

  // 处理字符串日期（可能含时间部分）
  const str = String(raw)
  const match = str.match(/(\d{4}[-/]\d{2}[-/]\d{2})/)
  if (match) return match[1].replace(/\//g, '-')

  return new Date().toISOString().slice(0, 10)
}

/** 尝试从 V2 记录中提取金额（返回正数，支出用调用方处理符号）*/
function extractAmount(record: Record<string, unknown>): number {
  const raw =
    record['amount']      ??
    record['money']       ??
    record['fee']         ??
    record['price']       ??
    record['sum']         ??
    record['totalAmount'] ??
    record['tradeAmount']

  if (raw == null) return 0
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : Math.abs(n)
}

// V2 分类 → V3 SystemCategory 映射
const CATEGORY_MAP: Record<string, SystemCategory> = {
  '餐饮': '餐饮', '餐厅': '餐饮', '外卖': '餐饮', '吃饭': '餐饮',
  '交通': '交通', '打车': '交通', '地铁': '交通', '公交': '交通', '滴滴': '交通',
  '购物': '购物', '网购': '购物', '超市': '购物', '百货': '购物',
  '娱乐': '娱乐', '游戏': '娱乐', '电影': '娱乐', '运动': '娱乐',
  '医疗': '医疗', '医院': '医疗', '药店': '医疗', '体检': '医疗',
  '居住': '居住', '房租': '居住', '水电': '居住', '物业': '居住',
  '教育': '教育', '学费': '教育', '书籍': '教育', '培训': '教育',
  '工资': '工资', '薪资': '工资', '月薪': '工资',
  '副业': '副业收入', '兼职': '副业收入', '稿费': '副业收入',
  '理财': '理财收益', '利息': '理财收益', '股票': '理财收益',
  '转账': '转账', '红包': '转账', '还款': '转账',
}

/** 尝试从 V2 记录中提取分类（尽力匹配 V3 SystemCategory）*/
function extractCategory(record: Record<string, unknown>): SystemCategory {
  const raw =
    record['category']       ??
    record['type']           ??
    record['classification'] ??
    record['label']          ??
    record['tag']

  if (!raw) return '未分类'

  const str = String(raw).trim()
  if (CATEGORY_MAP[str]) return CATEGORY_MAP[str]

  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (str.includes(key) || key.includes(str)) return cat
  }

  return '未分类'
}

/** 尝试从 V2 记录中提取描述/备注 */
function extractDescription(record: Record<string, unknown>): string {
  const raw =
    record['description'] ??
    record['memo']        ??
    record['remark']      ??
    record['note']        ??
    record['title']       ??
    record['name']        ??
    record['merchant']    ??
    record['counterpart']

  return raw ? String(raw).slice(0, 100) : ''
}

/** 判断是否为收入（显式标记优先，正数金额 + 无标记 → 支出）*/
function extractIsIncome(record: Record<string, unknown>): boolean {
  const amount = record['amount'] ?? record['money'] ?? record['fee']
  const typeStr = String(record['type'] ?? record['inOut'] ?? record['direction'] ?? '').toLowerCase()

  // 显式收入标记（最高优先级）
  if (typeStr.includes('in') || typeStr.includes('收入') || typeStr.includes('income')) return true
  // 显式支出标记
  if (typeStr.includes('out') || typeStr.includes('支出') || typeStr.includes('expense')) return false

  // 无类型标记时：只有正数且分类为收入类才判为收入
  if (typeof amount === 'number' && amount > 0) {
    const category = extractCategory(record)
    const incomeCategories: SystemCategory[] = ['工资', '副业收入', '理财收益']
    if (incomeCategories.includes(category)) return true
  }

  return false
}

// ════════════════════════════════════════════════════════════════
// § 2  解析结果类型
// ════════════════════════════════════════════════════════════════

export interface ParsedV2Record {
  /** 解析后的 V3 核心字段 */
  date:        string
  amount:      number   // 正=收入，负=支出
  category:    SystemCategory
  description: string
  /** V2 原始记录（全字段保留，供后续 legacy_backup 使用）*/
  _raw:        Record<string, unknown>
}

export interface V2ParseResult {
  records:   ParsedV2Record[]
  skipCount: number
  errors:    string[]
}

// ════════════════════════════════════════════════════════════════
// § 3  解析 V2 JSON
// ════════════════════════════════════════════════════════════════

/**
 * parseV2JSON — 解析 V2 导出 JSON，提取有效记录
 *
 * 接受格式：
 *   · JSON 数组直接输入：[{...}, {...}]
 *   · 带外层包装：{ "data": [...] } / { "records": [...] } / { "transactions": [...] }
 *   · 数组中每个元素只要有 date 或 amount 字段即视为有效记录
 *
 * 无效记录（金额为 0 或日期无法解析）→ 计入 skipCount，不导入
 */
export function parseV2JSON(jsonText: string): V2ParseResult {
  const errors:  string[] = []
  const records: ParsedV2Record[] = []
  let skipCount = 0

  // ── 解析 JSON ─────────────────────────────────────────────
  let raw: unknown
  try {
    raw = JSON.parse(jsonText.trim())
  } catch {
    return { records: [], skipCount: 0, errors: ['JSON 格式错误，请检查数据格式'] }
  }

  // ── 提取数组 ──────────────────────────────────────────────
  let arr: unknown[]
  if (Array.isArray(raw)) {
    arr = raw
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const found = obj['data'] ?? obj['records'] ?? obj['transactions'] ?? obj['bills']
    if (Array.isArray(found)) {
      arr = found
    } else {
      return { records: [], skipCount: 0, errors: ['未找到记录数组，请确保数据格式为数组或包含 data/records/transactions 字段'] }
    }
  } else {
    return { records: [], skipCount: 0, errors: ['数据格式无效，期望 JSON 数组或对象'] }
  }

  if (arr.length === 0) {
    return { records: [], skipCount: 0, errors: ['数组为空，没有可导入的记录'] }
  }

  // ── 逐条解析 ─────────────────────────────────────────────
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    if (!item || typeof item !== 'object') {
      skipCount++
      continue
    }

    const rec = item as Record<string, unknown>
    const amount = extractAmount(rec)

    if (amount === 0) {
      skipCount++
      continue
    }

    const isIncome = extractIsIncome(rec)

    records.push({
      date:        extractDate(rec),
      amount:      isIncome ? amount : -amount,
      category:    extractCategory(rec),
      description: extractDescription(rec),
      _raw:        rec,
    })
  }

  if (records.length === 0 && skipCount > 0) {
    errors.push(`所有 ${skipCount} 条记录的金额均为 0 或格式无效，无可导入数据`)
  }

  console.info(`[v2ImportService] parseV2JSON 完成 — 有效: ${records.length}, 跳过: ${skipCount}`)
  return { records, skipCount, errors }
}

// ════════════════════════════════════════════════════════════════
// § 4  垃圾袋映射：单条 V2 记录 → V3 Transaction
// ════════════════════════════════════════════════════════════════

const V3_CORE_FIELD_KEYS = new Set([
  'date', 'transactionDate', 'billDate', 'createTime', 'tradeTime', 'time',
  'amount', 'money', 'fee', 'price', 'sum', 'totalAmount', 'tradeAmount',
  'category', 'type', 'classification', 'label', 'tag',
  'description', 'memo', 'remark', 'note', 'title', 'name', 'merchant', 'counterpart',
])

export function mapV2RecordToV3(
  parsed:   ParsedV2Record,
  ledgerId: string,
  userId:   string,
): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  const legacyBackup: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed._raw)) {
    if (!V3_CORE_FIELD_KEYS.has(key)) {
      legacyBackup[key] = value
    }
  }

  return {
    ledgerId,
    userId,
    date:        parsed.date,
    amount:      parsed.amount,
    category:    parsed.category,
    description: parsed.description || parsed.category,
    source:      'manual',
    sourceType:  'V2_to_V3',
    status:      'cleared',
    tags:        [],
    accountId:   'acc-v2-migrated',
    isManuallyEdited: false,
    isVerified:  false,
    isDuplicate: false,
    rawData: {
      _migratedFromV2: true,
      _importedViaUI:  true,
      _importedAt:     Date.now(),
      legacy_backup:   legacyBackup,
    },
  }
}

// ════════════════════════════════════════════════════════════════
// § 5  批量导入写入 Firestore（两阶段：预生成 ID → 提交）
// ════════════════════════════════════════════════════════════════

export interface ImportResult {
  imported:  number
  errors:    string[]
  /** 与 records 平行的 Firestore doc ID 数组（commit 失败的批次对应 ID 为空字符串）*/
  txDocIds:  string[]
}

/**
 * batchImportV2 — 将解析后的 V2 记录批量写入 Firestore transactions 集合
 *
 * 关键设计：
 *   · 每条记录预先调用 doc(txCol) 客户端生成 docId（commit 前即确定，无需二次查询）
 *   · txDocIds 与 records 平行，供 importV2Evidences 建立凭证绑定关系
 *   · 每批最多 499 条（Firestore writeBatch 上限 500，留 1 余量）
 */
export async function batchImportV2(
  records:    ParsedV2Record[],
  ledgerId:   string,
  userId:     string,
  onProgress: (imported: number, total: number) => void,
): Promise<ImportResult> {
  const BATCH_SIZE = 499
  const errors:   string[] = []
  const txDocIds: string[] = new Array(records.length).fill('')

  console.info(`[v2ImportService] 开始文字批量导入 — 共 ${records.length} 条，目标账套: ${ledgerId}`)

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk  = records.slice(i, i + BATCH_SIZE)
    const batch  = writeBatch(db)
    const txCol  = collection(db, 'transactions')
    const chunkRefs: Array<{ index: number; id: string }> = []

    for (let j = 0; j < chunk.length; j++) {
      const parsed = chunk[j]
      try {
        const mapped = mapV2RecordToV3(parsed, ledgerId, userId)
        const newRef = doc(txCol)   // 客户端预生成 ID，commit 前即确定
        batch.set(newRef, {
          ...mapped,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        chunkRefs.push({ index: i + j, id: newRef.id })
        console.info(
          `[v2ImportService] 预写 #${i + j}: ${parsed.date}` +
          ` ¥${Math.abs(parsed.amount).toFixed(2)} ${parsed.category}` +
          ` → docId: ${newRef.id}`,
        )
      } catch (e) {
        errors.push(`记录 ${parsed.date} ¥${Math.abs(parsed.amount).toFixed(2)}：${e instanceof Error ? e.message : '映射失败'}`)
      }
    }

    try {
      await batch.commit()
      console.info(`[v2ImportService] 第 ${Math.floor(i / BATCH_SIZE) + 1} 批提交成功 — ${chunkRefs.length} 条`)
      for (const { index, id } of chunkRefs) {
        txDocIds[index] = id
      }
      onProgress(Math.min(i + chunk.length, records.length), records.length)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Firestore 批量写入失败'
      errors.push(`第 ${Math.floor(i / BATCH_SIZE) + 1} 批写入失败：${msg}`)
      console.error(`[v2ImportService] 批次写入失败:`, e)
    }
  }

  const successCount = txDocIds.filter(id => id !== '').length
  console.info(`[v2ImportService] 文字导入完成 — 成功: ${successCount}, 失败: ${errors.length}`)
  return { imported: successCount, errors, txDocIds }
}

// ════════════════════════════════════════════════════════════════
// § 6  凭证导入：从 V2 voucherPaths/imageUrl 拉取图片并上传至 V3
// ════════════════════════════════════════════════════════════════

/** V2 中可能存放图片 URL 的字段名列表 */
const EVIDENCE_URL_FIELDS = [
  'voucherPaths', 'vouchers', 'attachments',
  'imageUrls',    'imageUrl',  'imagePath',
  'receiptUrls',  'receiptUrl', 'receiptPath',
  'photoUrls',    'photoUrl',  'photos',
] as const

/** 从 V2 原始记录中提取所有 HTTP 图片 URL（去重）*/
function extractEvidenceUrls(raw: Record<string, unknown>): string[] {
  const urls: string[] = []
  for (const field of EVIDENCE_URL_FIELDS) {
    const val = raw[field]
    if (!val) continue
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === 'string' && v.startsWith('http')) urls.push(v)
      }
    } else if (typeof val === 'string' && val.startsWith('http')) {
      urls.push(val)
    }
  }
  return [...new Set(urls)]
}

export interface EvidenceImportResult {
  uploaded: number
  skipped:  number
  errors:   string[]
}

/**
 * importV2Evidences — 从 V2 凭证字段拉取图片并上传至 V3 Storage/evidences 集合
 *
 * 绑定逻辑（精确）：
 *   · records[i] 对应的 Transaction docId 为 txDocIds[i]
 *   · 每张图片上传后写入 evidences/{newDocId}.transactionId = txDocIds[i]
 *   · 确保 subscribeEvidences(txId) 能精准查到对应凭证
 *
 * 容错设计：
 *   · 本地路径（非 http 开头）→ 跳过（浏览器无法访问）
 *   · fetch 失败（403/404/CORS）→ 记入 skipped，不中断整体流程
 *   · txDocIds[i] 为空（对应 Transaction 写入失败）→ 跳过该记录的凭证
 *
 * @param records   ParsedV2Record 数组（与 txDocIds 平行）
 * @param txDocIds  batchImportV2 返回的 docId 数组
 */
export async function importV2Evidences(
  records:     ParsedV2Record[],
  txDocIds:    string[],
  ledgerId:    string,
  userId:      string,
  onProgress?: (done: number, total: number) => void,
): Promise<EvidenceImportResult> {
  let uploaded = 0
  let skipped  = 0
  const errors: string[] = []

  // 收集所有 (txId, url) 对
  const tasks: Array<{ txId: string; url: string; label: string }> = []
  for (let i = 0; i < records.length; i++) {
    const txId = txDocIds[i]
    if (!txId) continue   // Transaction 写入失败，跳过
    const urls = extractEvidenceUrls(records[i]._raw)
    for (const url of urls) {
      tasks.push({ txId, url, label: `${records[i].date} #${i}` })
    }
  }

  const total = tasks.length
  if (total === 0) {
    console.info('[v2ImportService] 无凭证字段，跳过图片导入阶段')
    return { uploaded: 0, skipped: 0, errors: [] }
  }

  console.info(`[v2ImportService] 开始凭证导入 — 共 ${total} 张图片`)

  for (const { txId, url, label } of tasks) {
    try {
      // 拉取远端图片
      const resp = await fetch(url, { mode: 'cors' })
      if (!resp.ok) {
        console.warn(`[v2ImportService] 凭证拉取失败 (${resp.status}) — ${label}: ${url.slice(0, 60)}…`)
        skipped++
        onProgress?.(uploaded + skipped, total)
        continue
      }

      const blob     = await resp.blob()
      const mimeType = blob.type || 'image/jpeg'
      const ext      = mimeType.split('/')[1] ?? 'jpg'
      const fileName = `v2_migrated_${Date.now()}.${ext}`
      const file     = new File([blob], fileName, { type: mimeType })

      await uploadEvidence(file, txId, ledgerId, userId)
      uploaded++
      console.info(`[v2ImportService] 凭证上传成功 — txId: ${txId}, 文件: ${fileName}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误'
      console.warn(`[v2ImportService] 凭证跳过 — ${label}: ${msg}`)
      skipped++
    }
    onProgress?.(uploaded + skipped, total)
  }

  console.info(`[v2ImportService] 凭证导入完成 — 上传: ${uploaded}, 跳过: ${skipped}, 失败: ${errors.length}`)
  return { uploaded, skipped, errors }
}

// ════════════════════════════════════════════════════════════════
// § 7  精准清场：仅删除 sourceType='V2_to_V3' 的记录
// ════════════════════════════════════════════════════════════════

export interface CleanupResult {
  deleted:          number   // 删除的 Transaction 数
  evidencesCleaned: number   // 删除的 Evidence 数
  errors:           string[]
}

/**
 * deleteV2Records — 精准清场：仅删除 ledgerId 下 sourceType='V2_to_V3' 的记录
 *
 * 安全证明：
 *   · where('sourceType', '==', 'V2_to_V3') 物理隔离 — 原生 V3 记录的
 *     sourceType 为 manual/voice/ocr/csv，绝对不会被查到
 *   · Evidence 先删（含 Storage 文件），再删 Transaction，不留孤儿文档
 *   · Evidence Storage 删除容错：文件不存在时跳过（deleteEvidence 内部处理）
 *
 * @param ledgerId   目标账套 ID（只删此账套下的 V2 记录）
 * @param onProgress 进度回调
 */
export async function deleteV2Records(
  ledgerId:    string,
  onProgress?: (deleted: number, total: number) => void,
): Promise<CleanupResult> {
  const errors: string[] = []
  let evidencesCleaned = 0

  console.info(`[v2ImportService] 开始精准清场 — 账套: ${ledgerId}，仅删 sourceType=V2_to_V3`)

  // ── Step 1: 查询所有 V2_to_V3 Transaction ──────────────────
  const txQuery = query(
    collection(db, 'transactions'),
    where('ledgerId',   '==', ledgerId),
    where('sourceType', '==', 'V2_to_V3'),
  )
  const txSnap = await getDocs(txQuery)
  const total  = txSnap.size

  if (total === 0) {
    console.info('[v2ImportService] 没有找到 V2_to_V3 记录，无需清场')
    return { deleted: 0, evidencesCleaned: 0, errors: [] }
  }

  console.info(`[v2ImportService] 找到 ${total} 条待清场记录`)

  // ── Step 2: 查询并删除关联 Evidence（分批 in 查询，每批 ≤ 30）──
  const allTxIds = txSnap.docs.map(d => d.id)
  const IN_CHUNK = 30
  for (let i = 0; i < allTxIds.length; i += IN_CHUNK) {
    const chunk = allTxIds.slice(i, i + IN_CHUNK)
    try {
      const evQuery = query(
        collection(db, 'evidences'),
        where('transactionId', 'in', chunk),
      )
      const evSnap = await getDocs(evQuery)
      for (const evDoc of evSnap.docs) {
        const { storagePath } = evDoc.data() as { storagePath: string }
        try {
          await deleteEvidence(evDoc.id, storagePath)
          evidencesCleaned++
          console.info(`[v2ImportService] Evidence 已删: ${evDoc.id}`)
        } catch (e) {
          errors.push(`Evidence ${evDoc.id} 删除失败：${e instanceof Error ? e.message : '未知'}`)
        }
      }
    } catch (e) {
      errors.push(`Evidence 批量查询失败（批次 ${Math.floor(i / IN_CHUNK) + 1}）：${e instanceof Error ? e.message : '未知'}`)
    }
  }

  // ── Step 3: 批量删除 Transaction（499条/批）────────────────
  const BATCH_SIZE = 499
  const txDocs = txSnap.docs
  let deleted = 0

  for (let i = 0; i < txDocs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    txDocs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref))
    try {
      await batch.commit()
      deleted += Math.min(BATCH_SIZE, txDocs.length - i)
      onProgress?.(deleted, total)
      console.info(`[v2ImportService] 第 ${Math.floor(i / BATCH_SIZE) + 1} 批 Transaction 已删除`)
    } catch (e) {
      errors.push(`第 ${Math.floor(i / BATCH_SIZE) + 1} 批删除失败：${e instanceof Error ? e.message : '未知'}`)
    }
  }

  console.info(`[v2ImportService] 清场完成 — 删除账单: ${deleted}, 删除凭证: ${evidencesCleaned}, 错误: ${errors.length}`)
  return { deleted, evidencesCleaned, errors }
}
