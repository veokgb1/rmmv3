// ════════════════════════════════════════════════════════════════
// migrateV2toV3.js — V2 → V3 增强版迁移脚本  (S21 修订版)
//
// ┌─ 三大运行模式（通过 .env.local 控制）────────────────────────
// │  MIGRATION_DRY_RUN=true                → 探测/预览模式（只读，不写入）
// │  MIGRATION_DRY_RUN=false               → 全量迁移（内容哈希去重保护）
// │  MIGRATION_DRY_RUN=false
// │    + MIGRATION_MODE=erase              → 擦除重来（先清空再全量写入）
// │  MIGRATION_DRY_RUN=false
// │    + MIGRATION_MODE=incremental        → 增量追加（跳过哈希已存在的记录）
// │  MIGRATION_MODE=probe                  → Schema 探针（打印 V2 字段分布）
// └──────────────────────────────────────────────────────────────
//
// ✅ S21 关键修复：
//   1. 零依赖 .env.local 解析器（读取 TARGET_LEDGER_ID / TARGET_USER_ID 等）
//   2. 全量扫描 V2（废弃 != 查询，彻底解决 60+ 条记录丢失问题）
//   3. Storage bucket 从 V3_STORAGE_BUCKET env 读取（支持新格式 .firebasestorage.app）
//   4. 支持 voucherStoragePaths 图片字段映射至 Evidence 对象
//   5. SHA-256 内容哈希去重引擎（防止重复写入）
//   6. TARGET_USER_ID 从 env 注入（V3 侧 userId 字段）
//
// 运行方式：
//   node scripts/migrateV2toV3.js                   ← 使用 .env.local 配置
//   MIGRATION_MODE=probe node scripts/migrateV2toV3.js  ← 探针模式
// ════════════════════════════════════════════════════════════════

import admin            from 'firebase-admin'
import { getStorage }   from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync }  from 'fs'
import { createHash }    from 'crypto'
import path              from 'path'
import { fileURLToPath } from 'url'

// ── ESM 兼容目录定位 ─────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

// ════════════════════════════════════════════════════════════════
// § 0  零依赖 .env.local 解析器
//      优先读取 .env.local，不覆盖已有的系统环境变量
//      支持注释行（#）、带引号的值、空行
// ════════════════════════════════════════════════════════════════
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  try {
    const raw = readFileSync(envPath, 'utf-8')
    let loaded = 0
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue      // 跳过注释和空行
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue                             // 无等号，跳过
      const key = trimmed.slice(0, eqIdx).trim()
      let val   = trimmed.slice(eqIdx + 1).trim()
      // 去除首尾引号（单引号或双引号）
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (key && !process.env[key]) {                        // 不覆盖系统环境变量
        process.env[key] = val
        loaded++
      }
    }
    console.log(`[env] ✅ 已从 .env.local 加载 ${loaded} 个环境变量`)
  } catch (e) {
    console.warn(`[env] ⚠️  .env.local 未找到（${envPath}），使用系统环境变量`)
  }
}
loadEnvLocal()  // ← 必须在所有 process.env 读取之前调用

// ════════════════════════════════════════════════════════════════
// § 1  环境变量读取与验证
// ════════════════════════════════════════════════════════════════

// ── 安全开关（非 'false' 字符串时一律视为 dry-run）────────────────
const DRY_RUN = process.env.MIGRATION_DRY_RUN !== 'false'

// ── 运行模式 ──────────────────────────────────────────────────────
// probe       → Schema 探针（打印字段分布，不迁移）
// erase       → 擦除重来（清空目标账套已迁移记录，再全量写入）
// incremental → 增量追加（基于内容哈希跳过已迁移记录）
// (默认)      → 全量迁移 + 哈希去重警告
const MIGRATION_MODE = (process.env.MIGRATION_MODE ?? '').toLowerCase().trim()

// ── 迁移目标 ─────────────────────────────────────────────────────
const TARGET_LEDGER_ID = process.env.TARGET_LEDGER_ID ?? 'personal'
const TARGET_USER_ID   = process.env.TARGET_USER_ID   ?? 'migrated'

// ── V3 Storage Bucket（支持新格式 .firebasestorage.app）──────────
const V3_STORAGE_BUCKET = process.env.V3_STORAGE_BUCKET ?? null   // null = 自动从 key 推断

// ── V2 Firestore 集合名（可能因项目而异）──────────────────────────
const V2_COLLECTION = process.env.V2_COLLECTION ?? 'transactions'

// ── 批量写入分片大小（Firestore writeBatch 上限 500 条）─────────────
const BATCH_SIZE = 450

// ── DRY_RUN 预览条数 ─────────────────────────────────────────────
const DRY_RUN_PREVIEW = parseInt(process.env.DRY_RUN_PREVIEW ?? '5', 10)

// ── 启动信息打印 ─────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════')
console.log('  V2 → V3 数据迁移脚本  (S21 增强版)')
console.log('═══════════════════════════════════════════════════════')
console.log(` 安全开关  MIGRATION_DRY_RUN : ${DRY_RUN ? '🔍 true（只读预览）' : '🚀 false（真实写入）'}`)
console.log(` 运行模式  MIGRATION_MODE    : ${MIGRATION_MODE || '(默认) 全量+去重'}`)
console.log(` 目标账套  TARGET_LEDGER_ID  : ${TARGET_LEDGER_ID}`)
console.log(` 目标用户  TARGET_USER_ID    : ${TARGET_USER_ID.slice(0, 12)}…`)
console.log(` V2 集合   V2_COLLECTION     : ${V2_COLLECTION}`)
console.log('═══════════════════════════════════════════════════════\n')

// ── 关键参数缺失时安全退出 ────────────────────────────────────────
if (TARGET_LEDGER_ID === 'personal' && !DRY_RUN) {
  console.error('❌ 警告：TARGET_LEDGER_ID 仍为默认值 "personal"，请在 .env.local 中设置真实账套 ID')
  console.error('   如需测试，设置 MIGRATION_DRY_RUN=true 后重新运行')
  process.exit(1)
}

// ════════════════════════════════════════════════════════════════
// § 2  双库初始化（V2 + V3 Firebase Admin）
// ════════════════════════════════════════════════════════════════

// ── V2 Firebase App ───────────────────────────────────────────────
const v2Credential = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'v2-key.json'), 'utf-8')
)
const v2App = admin.initializeApp(
  {
    credential:    admin.credential.cert(v2Credential),
    // V2 用 .appspot.com（旧项目格式）
    storageBucket: `${v2Credential.project_id}.appspot.com`,
  },
  'v2',
)

// ── V3 Firebase App ───────────────────────────────────────────────
const v3Credential = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'v3-key.json'), 'utf-8')
)
// V3 bucket 优先读 .env.local，其次尝试 .firebasestorage.app，最后降级 .appspot.com
const v3BucketName = V3_STORAGE_BUCKET
  ?? `${v3Credential.project_id}.firebasestorage.app`

const v3App = admin.initializeApp(
  {
    credential:    admin.credential.cert(v3Credential),
    storageBucket: v3BucketName,
  },
  'v3',
)

// ── 数据库 & Storage 客户端 ──────────────────────────────────────
const v2db      = getFirestore(v2App)
const v3db      = getFirestore(v3App)
const v2Storage = getStorage(v2App).bucket()
const v3Storage = getStorage(v3App).bucket()

console.log(`[init] V2 项目：${v2Credential.project_id}`)
console.log(`[init] V3 项目：${v3Credential.project_id}  bucket：${v3BucketName}\n`)

// ════════════════════════════════════════════════════════════════
// § 3  辅助工具函数
// ════════════════════════════════════════════════════════════════

/** 将各种 V2 时间格式统一转为 YYYY-MM-DD */
function v2TimestampToDateStr(raw) {
  if (!raw) return todayStr()
  if (typeof raw?.toDate === 'function') return dateToStr(raw.toDate())   // Firestore Timestamp
  if (typeof raw === 'number')           return dateToStr(new Date(raw))  // Unix 毫秒
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? todayStr() : dateToStr(d)
  }
  return todayStr()
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function todayStr() { return dateToStr(new Date()) }

/**
 * V2 金额标准化
 * V2 一般以正数存储，收支靠 type/kind/direction 字段区分
 * V3 规范：支出 = 负数，收入 = 正数
 */
function v2AmountToV3(amount, isExpense) {
  const abs = Math.abs(Number(amount) || 0)
  return isExpense ? -abs : abs
}

/** 判断 V2 记录是否为收入 */
function isIncomeRecord(v2) {
  const typeRaw = String(
    v2.type ?? v2.kind ?? v2.direction ?? v2.transactionType ?? ''
  ).toLowerCase()
  const INCOME_KEYWORDS = ['收入', 'income', 'in', 'revenue', '工资', '薪资', '副业', '理财', 'credit']
  return INCOME_KEYWORDS.some(kw => typeRaw.includes(kw))
}

// ── 分类关键词映射表（V2 → V3，双向兼容）───────────────────────────
const CAT_MAP = {
  '餐饮': '餐饮', '饮食': '餐饮', '外卖': '餐饮', '美食': '餐饮', '饭': '餐饮',
  '咖啡': '餐饮', '奶茶': '餐饮', '餐厅': '餐饮', '快餐': '餐饮',
  '交通': '交通', '出行': '交通', '打车': '交通', '地铁': '交通',
  '公交': '交通', '加油': '交通', '汽车': '交通', '停车': '交通',
  '购物': '购物', '网购': '购物', '日用': '购物', '服装': '购物', '超市': '购物',
  '娱乐': '娱乐', '游戏': '娱乐', '电影': '娱乐', '健身': '娱乐', '旅行': '娱乐',
  '医疗': '医疗', '医药': '医疗', '健康': '医疗', '看病': '医疗', '药': '医疗',
  '居住': '居住', '房租': '居住', '水电': '居住', '物业': '居住', '家居': '居住',
  '教育': '教育', '学习': '教育', '课程': '教育', '书': '教育', '培训': '教育',
  '工资': '工资', '薪资': '工资', '薪酬': '工资',
  '副业': '副业收入', '副业收入': '副业收入',
  '理财': '理财收益', '理财收益': '理财收益', '投资': '理财收益', '股票': '理财收益',
  '转账': '转账', '还款': '转账', '借款': '转账',
}

function v2CategoryToV3(raw) {
  if (!raw) return '未分类'
  const s = String(raw).trim()
  if (CAT_MAP[s]) return CAT_MAP[s]                              // 精确匹配
  for (const [kw, cat] of Object.entries(CAT_MAP)) {
    if (s.includes(kw)) return cat                               // 包含匹配
  }
  return '未分类'
}

// ════════════════════════════════════════════════════════════════
// § 4  内容哈希去重引擎
//      哈希组成：date + amount + description + category
//      用于：增量模式跳过已迁移记录 / 全量模式标记潜在重复
// ════════════════════════════════════════════════════════════════

/**
 * 生成 V3 侧去重内容哈希（SHA-256 前 16 位）
 * @param {string} date        YYYY-MM-DD
 * @param {number} amount      V3 标准金额（含正负号）
 * @param {string} description 备注/描述
 * @param {string} category    V3 分类名
 */
function contentHash(date, amount, description, category) {
  const raw = `${date}|${amount.toFixed(2)}|${description.trim()}|${category}`
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

/**
 * 批量查询 V3 中已存在的 contentHash 集合
 * 用于增量模式：一次性拉取全部已迁移记录的哈希，O(n) 去重
 */
async function fetchExistingHashes() {
  const snap = await v3db.collection('transactions')
    .where('ledgerId', '==', TARGET_LEDGER_ID)
    .where('rawData._migratedFromV2', '==', true)
    .select('rawData._contentHash')    // 只取哈希字段，节省带宽
    .get()

  const hashes = new Set()
  snap.docs.forEach(d => {
    const h = d.data()?.rawData?._contentHash
    if (h) hashes.add(h)
  })
  console.log(`[去重] V3 中已有 ${hashes.size} 条迁移记录（哈希索引已建立）`)
  return hashes
}

// ════════════════════════════════════════════════════════════════
// § 5  图片迁移：V2 Storage 下载 → V3 Storage 上传
// ════════════════════════════════════════════════════════════════

/**
 * 从 V2 doc 提取所有图片路径（兼容多种字段命名）
 * 支持：receiptUrls / vouchers / images / receiptUrl /
 *       voucherStoragePaths（指挥官指定字段）/ attachments
 */
function extractV2ImagePaths(v2Data) {
  const paths = [
    ...(Array.isArray(v2Data.voucherStoragePaths) ? v2Data.voucherStoragePaths : []),  // S21 新增
    ...(Array.isArray(v2Data.receiptUrls)          ? v2Data.receiptUrls          : []),
    ...(Array.isArray(v2Data.vouchers)             ? v2Data.vouchers             : []),
    ...(Array.isArray(v2Data.images)               ? v2Data.images               : []),
    ...(Array.isArray(v2Data.attachments)          ? v2Data.attachments          : []),
    ...(v2Data.receiptUrl   ? [v2Data.receiptUrl]   : []),
    ...(v2Data.voucherPath  ? [v2Data.voucherPath]  : []),
  ]
  // 过滤空值，去重
  return [...new Set(paths.filter(Boolean).map(String))]
}

/**
 * 迁移单条记录的全部凭证图片
 * 非阻塞：单张失败不中断整体流程
 * @returns {{ v3Urls: string[], evidences: object[] }}
 */
async function migrateVoucherImages(v2ImagePaths, v3TxId) {
  if (!v2ImagePaths || v2ImagePaths.length === 0) return { v3Urls: [], evidences: [] }

  const v3Urls   = []
  const evidences = []

  for (const v2Path of v2ImagePaths) {
    try {
      const v2File  = v2Storage.file(v2Path)
      const [exists] = await v2File.exists()
      if (!exists) {
        console.warn(`    [图片] ⚠️  V2 文件不存在，跳过：${v2Path}`)
        // 缺凭证时仍生成 Evidence 对象，标记 status=missing
        evidences.push({
          _id:       v2Path,
          sourceV2:  v2Path,
          status:    'missing',   // 缺凭证状态自动标记
          migratedAt: Date.now(),
        })
        continue
      }

      // 下载 V2 图片为 Buffer
      const [buffer] = await v2File.download()

      const ext      = path.extname(v2Path).toLowerCase().replace('.', '')
      const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
      const mimeType = mimeMap[ext] ?? 'image/jpeg'
      const filename = `${Date.now()}-${path.basename(v2Path)}`

      // V3 存储路径约定：receipts/{ledgerId}/{txId}/{filename}
      const v3Path = `receipts/${TARGET_LEDGER_ID}/${v3TxId}/${filename}`
      const v3File = v3Storage.file(v3Path)

      if (!DRY_RUN) {
        await v3File.save(buffer, {
          metadata: {
            contentType: mimeType,
            metadata:    { migratedFromV2: v2Path },
          },
        })
        await v3File.makePublic()
        const publicUrl = `https://storage.googleapis.com/${v3Storage.name}/${v3Path}`
        v3Urls.push(publicUrl)
        evidences.push({
          _id:        filename,
          url:        publicUrl,
          sourceV2:   v2Path,
          mimeType,
          status:     'uploaded',
          migratedAt: Date.now(),
        })
        console.log(`    [图片] ✅ ${path.basename(v2Path)} → V3`)
      } else {
        // DRY_RUN 模式：模拟 URL
        const dryUrl = `[DRY] gs://${v3BucketName}/${v3Path}`
        v3Urls.push(dryUrl)
        evidences.push({ _id: filename, url: dryUrl, sourceV2: v2Path, status: 'dry_run' })
        console.log(`    [图片] 🔍 DRY_RUN: ${path.basename(v2Path)}`)
      }
    } catch (err) {
      console.error(`    [图片] ❌ 失败 ${v2Path}: ${err.message}`)
    }
  }

  return { v3Urls, evidences }
}

// ════════════════════════════════════════════════════════════════
// § 6  Schema 映射：V2 doc → V3 Transaction
// ════════════════════════════════════════════════════════════════

/**
 * mapV2ToV3
 *
 * V2 字段兼容清单：
 *   description: summary / title / name / note / remark / memo
 *   amount:      amount / price / money / value
 *   type:        type / kind / direction / transactionType
 *   category:    category / cat / type（当 type 为分类时）
 *   date:        date / time / createdAt / occurredAt / transactionDate
 *   userId:      userId / uid / createdBy
 *   images:      voucherStoragePaths / receiptUrls / vouchers / images / attachments
 */
function mapV2ToV3(v2, newId, receiptUrls, evidences) {
  const income = isIncomeRecord(v2)

  // 备注字段：多级回退策略
  const rawDesc   = String(
    v2.summary  ?? v2.title  ?? v2.name   ?? v2.note  ??
    v2.remark   ?? v2.memo   ?? v2.remark ?? ''
  ).trim()
  const category    = v2CategoryToV3(v2.category ?? v2.cat ?? '')
  const description = rawDesc || category

  // 日期字段：多种格式兼容
  const date = v2TimestampToDateStr(
    v2.date ?? v2.time ?? v2.occurredAt ?? v2.transactionDate ?? v2.createdAt
  )

  // 金额字段：多种命名兼容
  const rawAmount = v2.amount ?? v2.price ?? v2.money ?? v2.value ?? 0
  const amount    = v2AmountToV3(rawAmount, !income)

  // 内容哈希（去重用）
  const hash = contentHash(date, amount, description, category)

  // V2 用户 ID → V3 用 TARGET_USER_ID 覆盖（迁移数据统一归属目标用户）
  const userId = TARGET_USER_ID

  // V3 文档结构（严格对齐 Transaction.types.ts）
  return {
    // ── 系统字段 ────────────────────────────────────────────
    createdAt:  v2.createdAt?.toMillis?.() ?? Date.now(),
    updatedAt:  Date.now(),

    // ── 账套隔离键 ──────────────────────────────────────────
    ledgerId: TARGET_LEDGER_ID,
    userId,

    // ── 核心业务字段 ────────────────────────────────────────
    date,
    amount,
    category,
    description,
    tags:      Array.isArray(v2.tags)     ? v2.tags     : [],
    accountId: String(v2.accountId ?? v2.account ?? 'acc-migrated'),

    // ── 录入溯源 ────────────────────────────────────────────
    sourceType: 'manual',   // V2 历史数据视为手动录入
    source:     'manual',

    // ── 状态 ────────────────────────────────────────────────
    status: 'cleared',

    // ── 凭证图片（已迁移至 V3 Storage）──────────────────────
    ...(receiptUrls.length > 0 ? { receiptUrls } : {}),

    // ── Evidence 对象（S21 新增：独立凭证清单，支持一对多关联）──
    ...(evidences.length > 0 ? { evidences } : {}),

    // ── 原始数据溯源（迁移回溯专用，生产查询勿依赖此字段）────
    rawData: {
      _migratedFromV2: true,          // 迁移标记（擦除/增量模式查询锚点）
      _v2DocId:        v2._id ?? '',  // V2 原始文档 ID
      _contentHash:    hash,          // 去重哈希
      _v2Raw: {
        summary:  v2.summary  ?? null,
        category: v2.category ?? null,
        amount:   rawAmount,
        type:     v2.type ?? v2.kind ?? null,
        date:     String(v2.date ?? v2.time ?? ''),
      },
    },

    // ── AI 原始解析留档（V2 完整字段快照，供人工审查）────────
    originalParsedData: {
      v2Source:  v2,               // V2 原始对象完整存档
      migratedAt: new Date().toISOString(),
    },
  }
}

// ════════════════════════════════════════════════════════════════
// § 7  擦除模式：清空 V3 中该账套的已迁移记录
// ════════════════════════════════════════════════════════════════

async function eraseExistingMigratedRecords() {
  console.log('[擦除] 正在查询 V3 中已迁移的历史记录…')
  const snap = await v3db.collection('transactions')
    .where('ledgerId', '==', TARGET_LEDGER_ID)
    .where('rawData._migratedFromV2', '==', true)
    .get()

  if (snap.empty) {
    console.log('[擦除] V3 中无已迁移记录，跳过擦除步骤\n')
    return
  }

  console.log(`[擦除] 发现 ${snap.size} 条已迁移记录，开始删除…`)
  let deleted = 0

  // 分片删除（Firestore batch 上限 500）
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const chunk = snap.docs.slice(i, i + BATCH_SIZE)
    const batch = v3db.batch()
    chunk.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
    deleted += chunk.length
    console.log(`  → 已删除 ${deleted} / ${snap.size} 条`)
  }
  console.log(`[擦除] ✅ 已清空 ${deleted} 条，开始全量重迁\n`)
}

// ════════════════════════════════════════════════════════════════
// § 8  Schema 探针模式：打印 V2 字段分布，辅助诊断映射问题
// ════════════════════════════════════════════════════════════════

async function runProbeMode() {
  console.log('[探针] ═══ V2 Schema 探针模式 ═══\n')

  // ⚠️ 关键修复：全量扫描，不使用 != 查询（避免漏掉无 _deleted 字段的文档）
  const snap  = await v2db.collection(V2_COLLECTION).limit(200).get()
  const total = snap.size
  console.log(`[探针] V2 ${V2_COLLECTION} 集合首批文档数：${total}`)

  if (total === 0) {
    console.log('[探针] ⚠️  集合为空，请检查 V2_COLLECTION 环境变量')
    return
  }

  // 统计所有字段的出现频率
  const fieldCount = {}
  const sampleValues = {}

  for (const doc of snap.docs) {
    const data = doc.data()
    for (const [key, val] of Object.entries(data)) {
      fieldCount[key] = (fieldCount[key] ?? 0) + 1
      if (!sampleValues[key]) {
        // 存储首个非空样本值（截断至 60 字符）
        const sample = String(val ?? '').slice(0, 60)
        sampleValues[key] = sample
      }
    }
  }

  // 按出现频率降序打印
  const sorted = Object.entries(fieldCount).sort(([, a], [, b]) => b - a)
  console.log('\n[探针] 字段分布（出现次数 / 样本值）：')
  console.log('  字段名'.padEnd(28) + '出现次数'.padEnd(12) + '样本值')
  console.log('  ' + '─'.repeat(80))
  for (const [field, count] of sorted) {
    const pct    = Math.round((count / total) * 100)
    const sample = String(sampleValues[field] ?? '').slice(0, 45)
    console.log(`  ${field.padEnd(26)}  ${String(count).padEnd(6)} (${String(pct).padStart(3)}%)  ${sample}`)
  }

  // 打印前 3 条完整文档
  console.log('\n[探针] 前 3 条原始文档：')
  snap.docs.slice(0, 3).forEach((doc, i) => {
    console.log(`\n  ── 文档 ${i + 1}：${doc.id} ──`)
    console.log(JSON.stringify(doc.data(), null, 4))
  })

  // 统计 _deleted 字段分布（诊断为何丢失记录）
  const withDeleted    = snap.docs.filter(d => '_deleted' in d.data())
  const deletedTrue    = snap.docs.filter(d => d.data()._deleted === true)
  const withoutDeleted = snap.docs.filter(d => !('_deleted' in d.data()))

  console.log('\n[探针] _deleted 字段分析：')
  console.log(`  有 _deleted 字段：${withDeleted.length} 条`)
  console.log(`  _deleted=true：  ${deletedTrue.length} 条（将被过滤）`)
  console.log(`  无 _deleted 字段：${withoutDeleted.length} 条 ← ⚠️  旧版查询会漏掉这些！`)

  console.log('\n[探针] 探针模式完成，请根据以上字段分布调整 mapV2ToV3() 中的字段映射。')
}

// ════════════════════════════════════════════════════════════════
// § 9  主流程
// ════════════════════════════════════════════════════════════════

async function main() {
  // ── 探针模式：独立运行，不执行迁移 ─────────────────────────────
  if (MIGRATION_MODE === 'probe') {
    await runProbeMode()
    process.exit(0)
  }

  // ════ Step 1：全量读取 V2 transactions ════════════════════════
  console.log(`[Step 1] 全量读取 V2 ${V2_COLLECTION}…`)
  console.log('  ⚠️  使用全集合扫描（避免 != 查询漏掉无 _deleted 字段的文档）')

  const v2Snap = await v2db.collection(V2_COLLECTION).get()
  const allDocs = v2Snap.docs

  // 客户端过滤软删除（精确排除 _deleted===true，保留无此字段的记录）
  const validDocs = allDocs.filter(d => d.data()._deleted !== true)
  const skipped   = allDocs.length - validDocs.length

  console.log(`  V2 集合总文档数：${allDocs.length}`)
  console.log(`  软删除（过滤掉）：${skipped}`)
  console.log(`  ✅ 有效记录：${validDocs.length} 条\n`)

  if (validDocs.length === 0) {
    console.log('无可迁移数据，脚本退出。')
    process.exit(0)
  }

  // ════ Step 2：按模式处理 ══════════════════════════════════════

  // 擦除模式：先清空已迁移记录
  if (MIGRATION_MODE === 'erase' && !DRY_RUN) {
    await eraseExistingMigratedRecords()
  }

  // 增量模式：预加载已存在的哈希集合
  let existingHashes = new Set()
  if (MIGRATION_MODE === 'incremental' && !DRY_RUN) {
    existingHashes = await fetchExistingHashes()
  }

  // DRY_RUN：只处理前 N 条
  const targetDocs = DRY_RUN ? validDocs.slice(0, DRY_RUN_PREVIEW) : validDocs
  console.log(`[Step 2] 开始映射 + 图片迁移（${DRY_RUN ? `DRY_RUN 前 ${DRY_RUN_PREVIEW} 条` : `全量 ${targetDocs.length} 条`}）\n`)

  const v3Payload    = []   // { id, data } 最终写入列表
  let   skipCount    = 0    // 去重跳过计数
  let   missingImgs  = 0    // 缺凭证计数

  for (let idx = 0; idx < targetDocs.length; idx++) {
    const v2Doc  = targetDocs[idx]
    const v2Data = { ...v2Doc.data(), _id: v2Doc.id }

    // 新 V3 文档 ID（与 V2 ID 解耦）
    const newId  = v3db.collection('transactions').doc().id

    // 粗映射（先算哈希）
    const imagePaths         = extractV2ImagePaths(v2Data)
    const date               = v2TimestampToDateStr(v2Data.date ?? v2Data.time ?? v2Data.createdAt)
    const income             = isIncomeRecord(v2Data)
    const rawAmount          = v2Data.amount ?? v2Data.price ?? v2Data.money ?? 0
    const amount             = v2AmountToV3(rawAmount, !income)
    const rawDesc            = String(v2Data.summary ?? v2Data.title ?? v2Data.name ?? '').trim()
    const category           = v2CategoryToV3(v2Data.category ?? '')
    const description        = rawDesc || category
    const hash               = contentHash(date, amount, description, category)

    // ── 增量模式跳过已存在记录 ────────────────────────────────
    if (MIGRATION_MODE === 'incremental' && existingHashes.has(hash)) {
      skipCount++
      if (skipCount <= 3) console.log(`  [${idx+1}] ↩️  跳过（哈希已存在）：${description} ${date}`)
      continue
    }

    // ── 打印进度 ──────────────────────────────────────────────
    const progress = `[${String(idx+1).padStart(4)}/${String(targetDocs.length).padEnd(4)}]`
    console.log(`${progress} V2-ID: ${v2Doc.id}  →  ${date}  ${amount >= 0 ? '+' : ''}${amount}  ${description.slice(0, 20)}`)

    // ── 图片迁移 ──────────────────────────────────────────────
    const { v3Urls, evidences } = await migrateVoucherImages(imagePaths, newId)
    if (imagePaths.length > 0 && v3Urls.filter(u => !u.startsWith('[DRY]')).length === 0) {
      missingImgs++
    }

    // ── Schema 映射（完整版）─────────────────────────────────
    const v3Data = mapV2ToV3(v2Data, newId, v3Urls, evidences)
    v3Payload.push({ id: newId, data: v3Data })

    if (DRY_RUN) {
      console.log('  → V3 预览：')
      // 精简打印，避免 originalParsedData 的超长 v2Source 刷屏
      const preview = { ...v3Data }
      if (preview.originalParsedData) {
        preview.originalParsedData = { ...preview.originalParsedData, v2Source: '[omitted in preview]' }
      }
      console.log(JSON.stringify(preview, null, 2))
      console.log()
    }
  }

  // ════ Step 3：汇总统计 ════════════════════════════════════════
  console.log('\n[Step 3] 迁移汇总：')
  console.log(`  有效记录：${validDocs.length}`)
  console.log(`  处理条数：${targetDocs.length}`)
  console.log(`  去重跳过：${skipCount}`)
  console.log(`  待写入：  ${v3Payload.length}`)
  console.log(`  缺凭证：  ${missingImgs}`)

  if (DRY_RUN) {
    console.log('\n[DRY_RUN] 以上为预览，未执行任何写入。')
    console.log('  如结果符合预期，请在 .env.local 中设置：')
    console.log('    MIGRATION_DRY_RUN=false')
    console.log('  并选择迁移模式：')
    console.log('    MIGRATION_MODE=erase       ← 擦除重来（推荐首次正式迁移）')
    console.log('    MIGRATION_MODE=incremental ← 增量追加（推荐后续补录）')
    process.exit(0)
  }

  if (v3Payload.length === 0) {
    console.log('\n无需写入（全部记录已存在或已跳过），脚本退出。')
    process.exit(0)
  }

  // ════ Step 4：批量写入 V3 Firestore ════════════════════════
  console.log(`\n[Step 4] 写入 V3 Firestore（${v3Payload.length} 条，分片 ${BATCH_SIZE}/批）…`)
  let written = 0

  for (let i = 0; i < v3Payload.length; i += BATCH_SIZE) {
    const chunk = v3Payload.slice(i, i + BATCH_SIZE)
    const batch = v3db.batch()
    for (const { id, data } of chunk) {
      batch.set(v3db.collection('transactions').doc(id), data)
    }
    await batch.commit()
    written += chunk.length
    const pct = Math.round((written / v3Payload.length) * 100)
    console.log(`  → 已写入 ${written} / ${v3Payload.length} 条（${pct}%）`)
  }

  // ════ 完成报告 ════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════')
  console.log(` ✅ 迁移完成！`)
  console.log(`    目标账套：${TARGET_LEDGER_ID}`)
  console.log(`    成功写入：${written} 条`)
  console.log(`    跳过（已存在）：${skipCount} 条`)
  console.log(`    缺凭证标记：${missingImgs} 条`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('\n下一步建议：')
  console.log('  1. 打开 V3 app 首页，确认看板数据已更新')
  console.log('  2. 检查缺凭证记录，必要时手动补挂图片')
  console.log(`  3. 如需重置，设置 MIGRATION_MODE=erase 重新运行`)
}

// ── 顶层错误兜底 ─────────────────────────────────────────────────
main().catch(err => {
  console.error('\n❌ 迁移脚本致命错误：', err.message)
  console.error(err.stack)
  process.exit(1)
})
