/**
 * import-to-firestore.ts
 * ════════════════════════════════════════════════════════════════
 * 终极入库脚本：将 V2 历史数据（含已迁移凭证）批量写入 V3 Firestore
 *
 * 数据源：
 *   · export.json        — V2 原始账单（60 条）
 *   · v3-migrated.json   — 已上传至 Firebase Storage 的凭证索引（63 张）
 *
 * 写入内容：
 *   · transactions 集合  — 账单文档（sourceType=V2_to_V3）
 *   · evidences 集合     — 凭证文档（transactionId 绑定）
 *   · transactions.receiptUrls — arrayUnion 写入凭证 URL
 *
 * 运行：npx tsx scripts/migration/import-to-firestore.ts
 * ════════════════════════════════════════════════════════════════
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, FieldValue }                  from 'firebase-admin/firestore'
import { readFileSync }                              from 'node:fs'
import { fileURLToPath }                             from 'node:url'
import { join }                                      from 'node:path'

// ── 路径配置 ───────────────────────────────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url))

const SERVICE_ACCOUNT_PATH = 'E:/rmm-2sys/rmm-workspace/2.V2rmm/migrate/serviceAccount.json'
const EXPORT_JSON_PATH      = 'E:/rmm-2sys/rmm-workspace/2.V2rmm/migrate/export.json'
const MIGRATED_JSON_PATH    = join(__dirname, 'v3-migrated.json')

const TARGET_LEDGER_ID = '0WZxzZnVfvrml2MEmNSr'
const TARGET_USER_ID   = 'IYQeanX9hRO4n1VFTHxwj8lXsh83'

// ── 类型定义 ──────────────────────────────────────────────────
interface V2Transaction {
  _legacyRowNum: number
  date:          string
  month?:        string
  type:          string
  category:      string
  amount:        number
  summary:       string
  source?:       string
  status?:       string
  voucherIds:    string[]
}

interface V3VoucherObject {
  legacyDriveId: string
  legacyRowNum:  number
  storageUrl:    string
  storagePath:   string
  fileName:      string
}

interface MigratedTx {
  _legacyRowNum:    number
  v3VoucherObjects: V3VoucherObject[]
}

// ── V2 分类 → V3 SystemCategory 映射 ──────────────────────────
function mapCategory(raw: string): string {
  const CATEGORY_MAP: Record<string, string> = {
    '餐饮': '餐饮', '餐厅': '餐饮', '外卖': '餐饮',
    '交通': '交通', '打车': '交通', '滴滴': '交通',
    '购物': '购物', '超市': '购物',
    '医疗': '医疗', '医院': '医疗', '药店': '医疗',
    '药费': '医疗', '医疗/药费': '医疗',
    '护工': '居住', '护理': '居住', '护工/护理费': '居住',
    '居住': '居住', '房租': '居住',
    '教育': '教育',
    '工资': '工资',
    '红包': '转账', '亲属红包': '转账',
    '转账': '转账', '还款': '转账',
    '生活用品': '购物', '生活用品/买菜': '购物',
    '生活服务': '居住',
    '其他': '未分类',
  }
  if (CATEGORY_MAP[raw]) return CATEGORY_MAP[raw]
  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (raw.includes(key) || key.includes(raw)) return cat
  }
  return '未分类'
}

// ── Firebase Admin 初始化 ──────────────────────────────────────
console.log('⚙️  初始化 Firebase Admin SDK...')
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8')) as ServiceAccount
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()
console.log(`✅ 已连接 Firestore 项目: ${(serviceAccount as Record<string,string>).project_id}`)

// ── 加载数据 ──────────────────────────────────────────────────
console.log('\n📖 读取数据源...')
const exportData      = JSON.parse(readFileSync(EXPORT_JSON_PATH,  'utf-8'))
const migratedData    = JSON.parse(readFileSync(MIGRATED_JSON_PATH,'utf-8'))

const v2Transactions: V2Transaction[]  = exportData.transactions
const migratedTxList: MigratedTx[]     = migratedData.transactions

// 构建 legacyRowNum → vouchers 快速查找表
const migratedMap = new Map<number, V3VoucherObject[]>()
for (const mt of migratedTxList) {
  migratedMap.set(mt._legacyRowNum, mt.v3VoucherObjects)
}

console.log(`  V2 账单: ${v2Transactions.length} 条`)
console.log(`  凭证索引: ${migratedTxList.length} 条记录，共 ${
  migratedTxList.reduce((s, t) => s + t.v3VoucherObjects.length, 0)
} 张凭证`)

// ── MIME 类型推断 ──────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif',  webp: 'image/webp', pdf: 'application/pdf',
  heic: 'image/heic', heif: 'image/heif',
}

// ── 主流程 ────────────────────────────────────────────────────
async function main(): Promise<void> {
  // 先确认 Firestore 中无残留 V2_to_V3 数据
  const existingSnap = await db.collection('transactions')
    .where('ledgerId',   '==', TARGET_LEDGER_ID)
    .where('sourceType', '==', 'V2_to_V3')
    .limit(1)
    .get()
  if (!existingSnap.empty) {
    console.error('\n❌ Firestore 中已有 V2_to_V3 数据！请先清场后再运行本脚本')
    console.error('   在前端 V2ImportModal → 危险区 → 清空已迁移数据')
    process.exit(1)
  }
  console.log('\n✅ Firestore 干净，无残留 V2 数据，开始写入...\n')

  const txCol  = db.collection('transactions')
  const evCol  = db.collection('evidences')

  let txWritten = 0
  let evWritten = 0
  const errors: string[] = []

  // Firestore Admin writeBatch 上限 500，保守用 499
  const BATCH_SIZE = 499

  // ── 第一阶段：写入 Transactions ────────────────────────────
  console.log('📦 阶段 1/2：写入账单...')
  // 预先生成所有 docRef（保证 txDocId 与 legacyRowNum 对应关系）
  const txDocMap = new Map<number, FirebaseFirestore.DocumentReference>()
  for (const tx of v2Transactions) {
    txDocMap.set(tx._legacyRowNum, txCol.doc())
  }

  // 按批次提交
  for (let i = 0; i < v2Transactions.length; i += BATCH_SIZE) {
    const chunk = v2Transactions.slice(i, i + BATCH_SIZE)
    const batch = db.batch()

    for (const tx of chunk) {
      const ref      = txDocMap.get(tx._legacyRowNum)!
      const vouchers = migratedMap.get(tx._legacyRowNum) ?? []
      const receiptUrls = vouchers.map(v => v.storageUrl)

      const isIncome = tx.type === '收入'
      const amount   = isIncome ? Math.abs(tx.amount) : -Math.abs(tx.amount)

      // V2 原始字段全部封存进 legacy_backup（垃圾袋隔离）
      const legacyBackup: Record<string, unknown> = {
        _legacyRowNum: tx._legacyRowNum,
        month:         tx.month,
        type:          tx.type,
        source:        tx.source,
        status:        tx.status,
        summary:       tx.summary,
        voucherIds:    tx.voucherIds,
      }

      batch.set(ref, {
        ledgerId:         TARGET_LEDGER_ID,
        userId:           TARGET_USER_ID,
        date:             tx.date,
        amount,
        category:         mapCategory(tx.category),
        description:      tx.summary || tx.category,
        source:           'manual',
        sourceType:       'V2_to_V3',
        status:           'cleared',
        tags:             [],
        accountId:        'acc-v2-migrated',
        isManuallyEdited: false,
        isVerified:       false,
        isDuplicate:      false,
        receiptUrls,
        rawData: {
          _migratedFromV2: true,
          _importedViaUI:  false,
          _importedAt:     Date.now(),
          legacy_backup:   legacyBackup,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    await batch.commit()
    txWritten += chunk.length
    process.stdout.write(`  ${txWritten}/${v2Transactions.length} 条账单已写入\r`)
  }
  console.log(`\n  ✅ 账单写入完成：${txWritten} 条`)

  // ── 第二阶段：写入 Evidences ───────────────────────────────
  console.log('\n🖼️  阶段 2/2：写入凭证文档...')
  const evTasks: Array<Record<string, unknown>> = []

  for (const tx of v2Transactions) {
    const txRef    = txDocMap.get(tx._legacyRowNum)!
    const vouchers = migratedMap.get(tx._legacyRowNum) ?? []
    for (const v of vouchers) {
      const ext      = v.fileName.split('.').pop()?.toLowerCase() ?? 'jpg'
      const fileType = MIME_MAP[ext] ?? 'image/jpeg'
      evTasks.push({
        transactionId: txRef.id,
        ledgerId:      TARGET_LEDGER_ID,
        uploadedBy:    TARGET_USER_ID,
        fileName:      v.fileName,
        storageUrl:    v.storageUrl,
        storagePath:   v.storagePath,
        fileType,
        fileSizeBytes: 0,
        uploadedAt:    Date.now(),
        status:        'ok',
      })
    }
  }

  for (let i = 0; i < evTasks.length; i += BATCH_SIZE) {
    const chunk = evTasks.slice(i, i + BATCH_SIZE)
    const batch = db.batch()
    chunk.forEach(ev => batch.set(evCol.doc(), ev))
    await batch.commit()
    evWritten += chunk.length
    process.stdout.write(`  ${evWritten}/${evTasks.length} 张凭证已写入\r`)
  }
  console.log(`\n  ✅ 凭证写入完成：${evWritten} 张`)

  // ── 最终报告 ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('📊 入库完成报告')
  console.log('═'.repeat(60))
  console.log(`  ✅ 账单写入：${txWritten} 条  →  transactions 集合`)
  console.log(`  ✅ 凭证写入：${evWritten} 张  →  evidences 集合`)
  console.log(`  ❌ 错误：${errors.length} 个`)
  console.log(`  🎯 目标账套：${TARGET_LEDGER_ID}`)
  console.log('\n🎉 V2 历史数据已全量写入 V3 Firestore！')
  console.log('   前往冲突中心逐一审核并确认（待验证队列）')

  if (errors.length > 0) {
    console.log('\n失败详情：')
    errors.forEach(e => console.log(' ', e))
  }

  process.exit(errors.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('💥 入库脚本异常终止:', err)
  process.exit(1)
})
