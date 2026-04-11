/**
 * stitch-data.ts
 * ════════════════════════════════════════════════════════════════
 * 缝合工具：将 export.json（V2 账单）与 v3-migrated.json（Firebase
 * Storage 凭证索引）通过 _legacyRowNum 合并，输出 v3-final-import.json
 *
 * 输出格式已与 parseV2JSON() 和 importV2EvidencesFromMigrated() 完全对齐：
 *   · transactions 数组中每条记录携带 _legacyRowNum（用于凭证匹配）
 *   · 每条记录携带 v3Vouchers（storageUrl / storagePath / fileName 数组）
 *   · 无凭证的记录 v3Vouchers 为空数组（允许纯文字进入待验证队列）
 *
 * 运行命令：
 *   npx tsx scripts/migration/stitch-data.ts
 *
 * 输出文件：
 *   scripts/migration/v3-final-import.json
 * ════════════════════════════════════════════════════════════════
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath }                           from 'node:url'
import { join, resolve }                           from 'node:path'

// ── 路径解析（ESM __dirname 替代）──────────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ── 输入/输出路径 ──────────────────────────────────────────────
const EXPORT_JSON_PATH  = resolve('E:/rmm-2sys/rmm-workspace/2.V2rmm/migrate/export.json')
const MIGRATED_JSON_PATH = join(__dirname, 'v3-migrated.json')
const OUTPUT_PATH        = join(__dirname, 'v3-final-import.json')

// ── 类型定义 ──────────────────────────────────────────────────

interface V2Transaction {
  _legacyRowNum: number
  date:          string
  month?:        string
  type:          string        // '收入' | '支出'
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

// ── 分类映射（与 v2ImportService.ts CATEGORY_MAP 保持一致）────

const CATEGORY_MAP: Record<string, string> = {
  '餐饮': '餐饮', '餐厅': '餐饮', '外卖': '餐饮', '吃饭': '餐饮',
  '交通': '交通', '打车': '交通', '地铁': '交通', '公交': '交通', '滴滴': '交通',
  '购物': '购物', '网购': '购物', '超市': '购物',
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

function mapCategory(raw: string): string {
  if (CATEGORY_MAP[raw]) return CATEGORY_MAP[raw]
  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (raw.includes(key) || key.includes(raw)) return cat
  }
  return '未分类'
}

// ── 主逻辑 ────────────────────────────────────────────────────

function main(): void {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║              stitch-data.ts  V2 → V3 缝合工具            ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  // ── 检查输入文件 ──────────────────────────────────────────────
  if (!existsSync(EXPORT_JSON_PATH)) {
    console.error(`❌ 找不到 export.json：${EXPORT_JSON_PATH}`)
    process.exit(1)
  }
  if (!existsSync(MIGRATED_JSON_PATH)) {
    console.error(`❌ 找不到 v3-migrated.json：${MIGRATED_JSON_PATH}`)
    console.error('   请先运行 migrate-drive-to-firebase.ts 生成该文件')
    process.exit(1)
  }

  // ── 读取数据源 ──────────────────────────────────────────────
  console.log('📖 读取数据源...')
  const exportData   = JSON.parse(readFileSync(EXPORT_JSON_PATH,   'utf-8'))
  const migratedData = JSON.parse(readFileSync(MIGRATED_JSON_PATH, 'utf-8'))

  const v2Txs: V2Transaction[]  = exportData.transactions ?? exportData
  const migratedTxs: MigratedTx[] = migratedData.transactions ?? []

  console.log(`  · V2 账单：      ${v2Txs.length} 条`)
  console.log(`  · 凭证索引记录： ${migratedTxs.length} 条`)

  const totalVouchers = migratedTxs.reduce((s, t) => s + t.v3VoucherObjects.length, 0)
  console.log(`  · 凭证总数：     ${totalVouchers} 张\n`)

  // ── 建立 legacyRowNum → vouchers 快速查找表 ─────────────────
  const migratedMap = new Map<number, V3VoucherObject[]>()
  for (const mt of migratedTxs) {
    migratedMap.set(mt._legacyRowNum, mt.v3VoucherObjects)
  }

  // ── 缝合 ──────────────────────────────────────────────────
  console.log('🔧 开始缝合...')

  let withPhotos    = 0
  let withoutPhotos = 0
  let multiPhoto    = 0

  const stitched = v2Txs.map((tx) => {
    const vouchers    = migratedMap.get(tx._legacyRowNum) ?? []
    const isIncome    = tx.type === '收入'
    const amount      = isIncome ? Math.abs(tx.amount) : -Math.abs(tx.amount)
    const category    = mapCategory(tx.category)

    if (vouchers.length === 0) {
      withoutPhotos++
    } else {
      withPhotos++
      if (vouchers.length > 1) multiPhoto++
    }

    return {
      // ── V2ImportModal / parseV2JSON 解析层需要的字段 ──────
      _legacyRowNum: tx._legacyRowNum,
      date:          tx.date,
      amount:        tx.amount,           // 原始正数（由 extractIsIncome 决定符号）
      type:          tx.type,             // '收入' | '支出'（extractIsIncome 读取）
      category:      tx.category,         // 原始 V2 分类（extractCategory 匹配）
      summary:       tx.summary,
      source:        tx.source  ?? '',
      status:        tx.status  ?? '',
      month:         tx.month   ?? '',
      voucherIds:    tx.voucherIds ?? [],

      // ── 直接可用的 V3 计算结果（stitch 预处理，免重算）────
      _stitched: {
        amount_v3:    amount,             // 已带符号（正=收入，负=支出）
        category_v3:  category,           // 已映射到 V3 SystemCategory
        description:  tx.summary || tx.category,
      },

      // ── 凭证数组（直接嵌入，v2ImportService 读取 v3Vouchers）
      v3Vouchers: vouchers.map(v => ({
        storageUrl:  v.storageUrl,
        storagePath: v.storagePath,
        fileName:    v.fileName,
      })),
    }
  })

  console.log('\n📊 缝合结果：')
  console.log(`  · 有凭证账单：  ${withPhotos} 条`)
  console.log(`  · 无凭证账单：  ${withoutPhotos} 条（允许进入待验证队列）`)
  console.log(`  · 多张凭证：    ${multiPhoto} 条`)
  console.log(`  · 合计账单：    ${stitched.length} 条`)

  // ════════════════════════════════════════════════════════════
  // § 强制校验：写入前三道断言，任何一道失败立即 throw，禁止生成文件
  // ════════════════════════════════════════════════════════════
  console.log('\n🔍 执行数据一致性强制校验...')

  // ── 断言 1：源数据 _legacyRowNum 无重复 ──────────────────
  const srcRowNums = v2Txs.map(t => t._legacyRowNum)
  const srcRowNumSet = new Set(srcRowNums)
  if (srcRowNumSet.size !== v2Txs.length) {
    const dupes = srcRowNums.filter((n, i) => srcRowNums.indexOf(n) !== i)
    throw new Error(
      `[ASSERT FAIL] V2 源数据存在重复 _legacyRowNum：${dupes.join(', ')}\n` +
      `请检查 export.json，修复后重新运行。严禁生成文件！`
    )
  }
  console.log(`  ✅ 断言 1 通过：源数据 ${v2Txs.length} 条，_legacyRowNum 全部唯一`)

  // ── 断言 2：输出条数必须 1:1 精确匹配源数据 ──────────────
  if (stitched.length !== v2Txs.length) {
    throw new Error(
      `[ASSERT FAIL] 数据条数不匹配！\n` +
      `  V2 源数据：${v2Txs.length} 条\n` +
      `  缝合输出：${stitched.length} 条\n` +
      `严禁生成文件！请排查 stitch-data.ts 缝合逻辑。`
    )
  }
  console.log(`  ✅ 断言 2 通过：输出 ${stitched.length} 条 === 源数据 ${v2Txs.length} 条，1:1 精确匹配`)

  // ── 断言 3：输出 _legacyRowNum 无重复（防 map 产生奇异副作用）
  const outRowNums  = stitched.map(t => t._legacyRowNum)
  const outRowNumSet = new Set(outRowNums)
  if (outRowNumSet.size !== stitched.length) {
    const dupes = outRowNums.filter((n, i) => outRowNums.indexOf(n) !== i)
    throw new Error(
      `[ASSERT FAIL] 缝合输出存在重复 _legacyRowNum：${dupes.join(', ')}\n` +
      `严禁生成文件！请排查 stitch-data.ts 缝合逻辑。`
    )
  }
  console.log(`  ✅ 断言 3 通过：输出 _legacyRowNum 全部唯一，无重复`)

  console.log('\n🎯 全部校验通过！V2 原始数据与最终 JSON 完全 1:1 匹配，允许写入文件。\n')

  // ── 输出 v3-final-import.json ──────────────────────────────
  const output = {
    _format:      'v3-final-import',    // 格式标识，让前端解析器识别
    _version:     '1.0',
    generatedAt:  new Date().toISOString(),
    stats: {
      totalTransactions: stitched.length,
      withVouchers:      withPhotos,
      withoutVouchers:   withoutPhotos,
      totalVouchers,
    },
    transactions: stitched,
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8')

  console.log(`\n✅ 输出文件：${OUTPUT_PATH}`)
  console.log(`   大小：${(Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(1)} KB`)
  console.log('\n下一步：')
  console.log('  1. 打开前端导入弹窗 → 选择目标账套')
  console.log('  2. 上传 v3-final-import.json（无需再单独上传 v3-migrated.json）')
  console.log('  3. 预览确认 → 导入 → 前往治理中心逐一审核\n')
}

main()
