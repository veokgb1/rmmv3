// ════════════════════════════════════════════════════════════════
// migrateV2toV3.js — V2 → V3 带图历史数据一次性迁移脚本
//
// 功能：
//   1. 读取 V2 Firestore 的 transactions（过滤 _deleted）
//   2. 下载 V2 Storage 的 voucher 图片（若有）
//   3. 上传图片至 V3 Storage，获得新 URL 列表
//   4. 按 V3 Schema 映射字段，写入 V3 Firestore transactions 集合
//
// 安全开关：DRY_RUN = true 时只读不写，仅 console.log 前 3 条结果
//
// 使用前置条件：
//   · Node.js >= 18（支持 fetch、stream/promises）
//   · npm install firebase-admin node-fetch（脚本顶部引入）
//   · 项目根目录下存在 v2-key.json 和 v3-key.json（Service Account 凭证）
//
// 运行方式：
//   DRY_RUN=true  node scripts/migrateV2toV3.js
//   DRY_RUN=false node scripts/migrateV2toV3.js   ← 真实写入，不可逆！
// ════════════════════════════════════════════════════════════════

import admin            from 'firebase-admin'
import { getStorage }   from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync }  from 'fs'
import { Readable }      from 'stream'
import path              from 'path'
import { fileURLToPath } from 'url'

// ── 目录定位（ESM 兼容，替代 __dirname） ──────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

// ════════════════════════════════════════════════════════════════
// § 1  沙盒安全开关
//      DRY_RUN = true  → 只读预览，console.log 前 3 条，绝不写入
//      DRY_RUN = false → 执行真实 Storage 上传 + Firestore 写入
// ════════════════════════════════════════════════════════════════
const DRY_RUN = true   // ← 上线前必须改为 false！

// ── 写入目标账套（V3 侧） ─────────────────────────────────────
const TARGET_LEDGER_ID = 'personal'   // 修改为实际目标账套 ID

// ── 批量写入分片大小（Firestore writeBatch 上限 500 条） ────────
const BATCH_SIZE = 450

// ════════════════════════════════════════════════════════════════
// § 2  双库初始化
// ════════════════════════════════════════════════════════════════

// V2 Firebase App
const v2Credential = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'v2-key.json'), 'utf-8')
)
const v2App = admin.initializeApp(
  {
    credential:  admin.credential.cert(v2Credential),
    storageBucket: v2Credential.project_id + '.appspot.com',  // V2 默认 bucket
  },
  'v2',   // app 名称（必须唯一，避免与 default 冲突）
)

// V3 Firebase App
const v3Credential = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'v3-key.json'), 'utf-8')
)
const v3App = admin.initializeApp(
  {
    credential:  admin.credential.cert(v3Credential),
    storageBucket: v3Credential.project_id + '.appspot.com',  // V3 默认 bucket
  },
  'v3',
)

// 数据库 & Storage 客户端
const v2db      = getFirestore(v2App)
const v3db      = getFirestore(v3App)
const v2Storage = getStorage(v2App).bucket()
const v3Storage = getStorage(v3App).bucket()

// ════════════════════════════════════════════════════════════════
// § 3  辅助函数
// ════════════════════════════════════════════════════════════════

/**
 * v2TimestampToDateStr — 将 V2 时间戳转为 YYYY-MM-DD 字符串
 *
 * V2 可能存储：
 *   · Firestore Timestamp 对象（.toDate()）
 *   · Unix 毫秒数（number）
 *   · ISO 字符串（string）
 *   · 完全缺失（fallback 到今天）
 */
function v2TimestampToDateStr(raw) {
  if (!raw) return todayStr()
  // Firestore Timestamp 对象（含 .toDate 方法）
  if (typeof raw?.toDate === 'function') {
    return dateToStr(raw.toDate())
  }
  // 毫秒数
  if (typeof raw === 'number') {
    return dateToStr(new Date(raw))
  }
  // ISO / 自由格式字符串
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? todayStr() : dateToStr(d)
  }
  return todayStr()
}

function dateToStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function todayStr() {
  return dateToStr(new Date())
}

/**
 * v2AmountToV3 — 统一金额符号
 * V2 一般用正数存储，收支靠 type/direction 字段区分；
 * V3 规范：支出 = 负数，收入 = 正数
 */
function v2AmountToV3(amount, isExpense) {
  const abs = Math.abs(Number(amount) || 0)
  return isExpense ? -abs : abs
}

/**
 * v2CategoryToV3 — 分类名粗粒度映射
 * V2 分类名可能不同，先做简单关键词映射，无匹配归"未分类"
 */
const CAT_MAP = {
  '餐饮': '餐饮', '饮食': '餐饮', '外卖': '餐饮', '美食': '餐饮',
  '交通': '交通', '出行': '交通', '打车': '交通', '地铁': '交通',
  '购物': '购物', '网购': '购物', '日用': '购物',
  '娱乐': '娱乐', '游戏': '娱乐', '电影': '娱乐',
  '医疗': '医疗', '医药': '医疗', '健康': '医疗',
  '居住': '居住', '房租': '居住', '水电': '居住',
  '教育': '教育', '学习': '教育', '课程': '教育',
  '工资': '工资', '薪资': '工资',
  '副业': '副业收入', '副业收入': '副业收入',
  '理财': '理财收益', '理财收益': '理财收益', '投资': '理财收益',
  '转账': '转账',
}

function v2CategoryToV3(raw) {
  if (!raw) return '未分类'
  const s = String(raw).trim()
  if (CAT_MAP[s]) return CAT_MAP[s]
  // 关键词包含匹配
  for (const [kw, cat] of Object.entries(CAT_MAP)) {
    if (s.includes(kw)) return cat
  }
  return '未分类'
}

// ════════════════════════════════════════════════════════════════
// § 4  图片迁移：V2 Storage 下载 → V3 Storage 上传
// ════════════════════════════════════════════════════════════════

/**
 * migrateVoucherImages
 *
 * @param {string[]} v2ImagePaths  V2 Storage 中的图片路径数组（相对 bucket 根）
 * @param {string}   v3TxId        V3 侧新事务 ID（用于构造 V3 存储路径）
 * @returns {Promise<string[]>}    V3 图片的公开下载 URL 数组
 */
async function migrateVoucherImages(v2ImagePaths, v3TxId) {
  if (!v2ImagePaths || v2ImagePaths.length === 0) return []

  const v3Urls = []

  for (const v2Path of v2ImagePaths) {
    try {
      // ① 从 V2 Storage 获取文件引用
      const v2File = v2Storage.file(v2Path)
      const [exists] = await v2File.exists()
      if (!exists) {
        console.warn(`  [图片] V2 文件不存在，跳过：${v2Path}`)
        continue
      }

      // ② 下载为 Buffer（admin SDK 的 download()）
      const [buffer] = await v2File.download()

      // ③ 确定 MIME 类型（按后缀简单推断）
      const ext      = path.extname(v2Path).toLowerCase().replace('.', '')
      const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
      const mimeType = mimeMap[ext] ?? 'image/jpeg'
      const filename = `${Date.now()}-${path.basename(v2Path)}`

      // ④ 上传至 V3 Storage，路径约定：receipts/{ledgerId}/{txId}/{filename}
      const v3Path = `receipts/${TARGET_LEDGER_ID}/${v3TxId}/${filename}`
      const v3File = v3Storage.file(v3Path)

      if (!DRY_RUN) {
        await v3File.save(buffer, {
          metadata: {
            contentType: mimeType,
            // 保留 V2 来源路径，便于问题溯源
            metadata: { migratedFromV2: v2Path },
          },
        })
        // 生成永久公开下载 URL（需要 bucket 设置为公开，或使用签名 URL）
        await v3File.makePublic()
        const publicUrl = `https://storage.googleapis.com/${v3Storage.name}/${v3Path}`
        v3Urls.push(publicUrl)
        console.log(`  [图片] ✅ ${v2Path} → ${v3Path}`)
      } else {
        // DRY_RUN 模式：模拟 URL 不实际上传
        v3Urls.push(`[DRY_RUN] https://storage.googleapis.com/v3-bucket/${v3Path}`)
        console.log(`  [图片] 🔍 DRY_RUN: ${v2Path} → ${v3Path}`)
      }
    } catch (err) {
      // 图片迁移失败不中断整体流程，记录错误继续下一张
      console.error(`  [图片] ❌ 迁移失败 ${v2Path}:`, err.message)
    }
  }

  return v3Urls
}

// ════════════════════════════════════════════════════════════════
// § 5  Schema 映射：V2 Transaction → V3 Transaction
// ════════════════════════════════════════════════════════════════

/**
 * mapV2ToV3
 *
 * V2 字段参考（按项目实际调整）：
 *   v2.summary         → V3 description（主备注）
 *   v2.title / v2.name → V3 description（优先级低于 summary）
 *   v2.amount          → V3 amount（需附加符号）
 *   v2.type / v2.kind  → 判断 isExpense
 *   v2.category        → V3 category（关键词映射）
 *   v2.date / v2.time  → V3 date (YYYY-MM-DD)
 *   v2.userId          → V3 userId
 *   v2.receiptUrls / v2.vouchers → 图片路径列表（待迁移）
 *
 * @param {Record<string,any>} v2  V2 原始文档数据
 * @param {string}             newId  Firestore 新文档 ID（用于图片路径）
 * @param {string[]}           receiptUrls  已迁移的 V3 图片 URL 列表
 */
function mapV2ToV3(v2, newId, receiptUrls) {
  // 判断是否为支出（V2 可能用 type/kind/direction 等不同字段）
  const typeRaw  = String(v2.type ?? v2.kind ?? v2.direction ?? '')
  const isExpense = !['收入', 'income', 'in', 'revenue', '工资', '薪资', '副业', '理财']
    .some(kw => typeRaw.toLowerCase().includes(kw.toLowerCase()))

  // 备注：优先用 summary，其次 title/name，最后降级为分类名
  const rawDesc   = String(v2.summary ?? v2.title ?? v2.name ?? v2.note ?? '').trim()
  const description = rawDesc || v2CategoryToV3(v2.category)

  // 构造 V3 文档（字段顺序与 Transaction.types.ts 保持一致）
  const v3Doc = {
    // 系统字段（由迁移脚本生成，非 serverTimestamp——避免批量写入时全变同一时间戳）
    createdAt:  v2.createdAt?.toMillis?.() ?? Date.now(),
    updatedAt:  Date.now(),

    // 账套隔离键
    ledgerId:   TARGET_LEDGER_ID,
    userId:     String(v2.userId ?? v2.uid ?? 'migrated'),

    // 核心业务字段
    date:       v2TimestampToDateStr(v2.date ?? v2.time ?? v2.createdAt),
    amount:     v2AmountToV3(v2.amount, isExpense),
    category:   v2CategoryToV3(v2.category),
    description,
    tags:       Array.isArray(v2.tags) ? v2.tags : [],
    accountId:  String(v2.accountId ?? v2.account ?? 'acc-migrated'),

    // 录入溯源
    sourceType: 'manual',   // V2 数据视为手动录入
    source:     'manual',

    // 原始数据留档（迁移溯源）
    rawData: {
      _migratedFromV2: true,
      _v2DocId: v2._id ?? newId,
      _v2Raw: {
        summary:  v2.summary,
        category: v2.category,
        amount:   v2.amount,
        type:     v2.type ?? v2.kind,
        date:     String(v2.date ?? v2.time ?? ''),
      },
    },
    originalParsedData: { v2Source: v2 },

    // 状态
    status: 'cleared',

    // V2 凭证图片（已迁移至 V3 Storage）
    ...(receiptUrls.length > 0 ? { receiptUrls } : {}),
  }

  return v3Doc
}

// ════════════════════════════════════════════════════════════════
// § 6  主流程
// ════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log(' V2 → V3 数据迁移脚本')
  console.log(` 模式：${DRY_RUN ? '🔍 DRY_RUN（只读预览）' : '🚀 真实写入（不可逆！）'}`)
  console.log(` 目标账套：${TARGET_LEDGER_ID}`)
  console.log('═══════════════════════════════════════════════════\n')

  // ── Step 1：读取 V2 transactions（过滤软删除） ────────────────
  console.log('[Step 1] 读取 V2 transactions…')
  const v2Snap = await v2db.collection('transactions')
    .where('_deleted', '!=', true)   // 过滤软删除
    .get()

  // 兼容无 _deleted 字段的文档（不设该字段的也应迁移）
  const v2Docs = v2Snap.docs.filter(d => d.data()._deleted !== true)
  console.log(`  → 有效记录 ${v2Docs.length} 条\n`)

  if (v2Docs.length === 0) {
    console.log('无可迁移数据，脚本退出。')
    process.exit(0)
  }

  // DRY_RUN 只处理前 3 条
  const targetDocs = DRY_RUN ? v2Docs.slice(0, 3) : v2Docs

  // ── Step 2：逐条映射 + 图片迁移 ──────────────────────────────
  console.log(`[Step 2] 映射 + 图片迁移（${DRY_RUN ? '仅前 3 条' : '全量'}）…\n`)

  const v3Payload = []   // { id, data } 最终写入列表

  for (let idx = 0; idx < targetDocs.length; idx++) {
    const v2Doc  = targetDocs[idx]
    const v2Data = v2Doc.data()
    // 生成 V3 新文档 ID（与 V2 ID 解耦，避免冲突）
    const newId  = v3db.collection('transactions').doc().id

    console.log(`  [${idx + 1}/${targetDocs.length}] V2 ID: ${v2Doc.id}`)

    // 提取 V2 图片路径（字段名按 V2 实际情况调整）
    const v2ImagePaths = [
      ...(Array.isArray(v2Data.receiptUrls)   ? v2Data.receiptUrls   : []),
      ...(Array.isArray(v2Data.vouchers)       ? v2Data.vouchers      : []),
      ...(Array.isArray(v2Data.images)         ? v2Data.images        : []),
      ...(v2Data.receiptUrl ? [v2Data.receiptUrl] : []),
    ].filter(Boolean)

    // 迁移图片（DRY_RUN 时不实际上传）
    const receiptUrls = await migrateVoucherImages(v2ImagePaths, newId)

    // Schema 映射
    const v3Data = mapV2ToV3(v2Data, newId, receiptUrls)
    v3Payload.push({ id: newId, data: v3Data })

    if (DRY_RUN) {
      console.log('  → 映射结果预览：')
      console.log(JSON.stringify(v3Data, null, 4))
      console.log()
    }
  }

  // ── Step 3：批量写入 V3 Firestore ─────────────────────────────
  if (DRY_RUN) {
    console.log('\n[Step 3] DRY_RUN 模式：跳过 Firestore 写入。')
    console.log(`  → 如果以上结果符合预期，请将 DRY_RUN 改为 false 后重新运行。`)
    process.exit(0)
  }

  console.log(`\n[Step 3] 写入 V3 Firestore（共 ${v3Payload.length} 条，分片 ${BATCH_SIZE} 条/批）…`)
  let written = 0

  // 按 BATCH_SIZE 分片，避免超过 Firestore 单批 500 条上限
  for (let i = 0; i < v3Payload.length; i += BATCH_SIZE) {
    const chunk = v3Payload.slice(i, i + BATCH_SIZE)
    const batch = v3db.batch()

    for (const { id, data } of chunk) {
      const ref = v3db.collection('transactions').doc(id)
      batch.set(ref, data)
    }

    await batch.commit()
    written += chunk.length
    console.log(`  → 已写入 ${written} / ${v3Payload.length} 条`)
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log(` ✅ 迁移完成！共写入 V3 账套 [${TARGET_LEDGER_ID}] ${written} 条账单`)
  console.log('═══════════════════════════════════════════════════')
}

// ── 启动并统一捕获顶层错误 ────────────────────────────────────────
main().catch(err => {
  console.error('\n❌ 迁移脚本发生致命错误：', err)
  process.exit(1)
})
