// 支付宝账单 CSV 解析器 — S4 战略升级版
// 严格按照 SKILL_DATA_PARSING.md 的 STEP 1-7 执行
// 新增：tags / accountId / sourceType / originalParsedData 字段填充

import type { ParsedTransaction, ParseResult, ParseErrorItem } from '@/types/ParseResult.types'
import { mapCategory, parseAmount, parseDate, parseCsvLine, buildRowMap } from './parseUtils'
import { guessAccountId } from '@/types/Account.types'

// ── 支付宝账单的元数据行数 ────────────────────────────────────
// 支付宝导出的 CSV：前4行是说明文字，第5行是表头，第6行起是数据
const ALIPAY_SKIP_ROWS = 4

// ── 支付宝账单表头字段名 ──────────────────────────────────────
// 不同版本的支付宝导出格式可能有细微差异，此处兼容两种常见版本
const COL = {
  TIME:        '交易创建时间',
  CATEGORY:    '交易分类',
  COUNTERPART: '交易对方',
  GOODS:       '商品说明',
  IO:          '收/支',
  AMOUNT:      '金额',
  METHOD:      '收/付款方式',
  STATUS:      '交易状态',
  REMARK:      '备注',
  ORDER_NO:    '交易订单号',
  MERCHANT_NO: '商家订单号',
} as const

// 支付宝"不计收支"类型的标识（如转账到余额宝，不计入收支统计）
const NON_INCOME_EXPENSE_TYPES = ['不计收支', '其他']

/**
 * parseAlipay — 解析支付宝账单 CSV 文本
 *
 * @param rawText 从支付宝导出的完整 CSV 文本
 * @param existingTransactions 已存在账单（用于重复检测）
 * @returns ParseResult 完整解析结果
 */
export function parseAlipay(
  rawText: string,
  existingTransactions: ParsedTransaction[] = [],
): ParseResult {
  // 按行分割，兼容 \r\n 和 \n
  const lines = rawText.split(/\r?\n/)

  // STEP 2：跳过前4行元数据，第5行（index=4）是表头
  const headerLine = lines[ALIPAY_SKIP_ROWS]
  if (!headerLine) {
    return emptyResult('alipay')
  }

  // 解析表头
  const headers = parseCsvLine(headerLine)

  // 数据行从第6行（index=5）开始
  const dataLines = lines.slice(ALIPAY_SKIP_ROWS + 1)

  const success:    ParsedTransaction[] = []
  const errors:     ParseErrorItem[]    = []
  const duplicates: ParsedTransaction[] = []
  let fieldErrorCount = 0

  dataLines.forEach((line, index) => {
    const rowIndex = ALIPAY_SKIP_ROWS + 2 + index

    // 跳过空行
    if (!line.trim()) return

    // 跳过支付宝末尾的汇总与说明行（通常含"共"字或"说明"）
    if (/^[-]+$/.test(line.trim())) return    // 全是连字符的分割行
    if (line.includes('客服电话')) return      // 说明行
    if (line.includes('导出时间')) return      // 导出信息行

    let values: string[]
    try {
      values = parseCsvLine(line)
    } catch {
      errors.push({ rowIndex, rawContent: line, reason: 'CSV 格式解析失败' })
      return
    }

    if (values.length < headers.length - 3) {
      errors.push({ rowIndex, rawContent: line, reason: `字段数量不足（期望≥${headers.length - 3}，实际${values.length}）` })
      return
    }

    // STEP 3：组合键值对
    const row = buildRowMap(headers, values)
    const rawData = { ...row }

    // 过滤"不计收支"类型（如余额宝内部转账，对账单无意义）
    const ioField = row[COL.IO] ?? ''
    if (NON_INCOME_EXPENSE_TYPES.includes(ioField.trim())) return

    // 过滤交易关闭/已退款的无效记录
    const status = row[COL.STATUS] ?? ''
    if (status.includes('交易关闭') || status.includes('已全额退款')) return

    // STEP 3 + STEP 4：字段映射
    const date   = parseDate(row[COL.TIME])
    const amount = parseAmount(row[COL.AMOUNT], row[COL.IO])

    // 支付宝描述：优先商品说明，其次交易对方
    const description = (row[COL.GOODS]?.trim() || row[COL.COUNTERPART]?.trim() || '（无描述）')

    // STEP 5：自动分类（利用交易分类+商品说明双维度）
    const category = mapCategory(row[COL.CATEGORY], row[COL.GOODS], row[COL.COUNTERPART])

    const parseErrors: string[] = []
    if (date   === null) parseErrors.push('DATE_PARSE_FAILED')
    if (amount === null) parseErrors.push('AMOUNT_PARSE_FAILED')

    // 战略支柱①：从"收/付款方式"字段推断资金账户 ID（传入平台标识以正确归属银行卡）
    const accountId = guessAccountId(row[COL.METHOD], 'alipay')

    // 首次解析结果快照
    const originalParsedData: Record<string, unknown> = {
      date,
      amount,
      category,
      description,
      accountId,
    }

    const tx: ParsedTransaction = {
      // ── 业务核心字段 ────────────────────────────────────────
      date,
      amount,
      category,
      description,
      // ── 战略支柱①：标签与资金账户 ──────────────────────────
      tags:      [],         // 解析阶段留空
      accountId,             // 从支付方式推断
      // ── 战略支柱②：录入方式与溯源 ──────────────────────────
      sourceType:          'csv',
      source:              'alipay',
      rawData,
      originalParsedData,
      // ── OCR 字段默认值 ─────────────────────────────────────
      ocrConfidence: 1,
      ocrDoubtSpans: [],
      rowIndex,
      parseError: parseErrors.length > 0 ? parseErrors.join(',') : undefined,
    }

    if (parseErrors.length > 0) fieldErrorCount++

    // STEP 7：重复检测
    const allExisting = [...existingTransactions, ...success]
    if (isDuplicate(tx, allExisting)) {
      tx.isDuplicate = true
      duplicates.push(tx)
    }

    success.push(tx)
  })

  return {
    source:         'alipay',
    total:          dataLines.filter(l => l.trim() && !l.match(/^[-]+$/)).length,
    success,
    errors,
    duplicates,
    successCount:   success.filter(t => !t.parseError && !t.isDuplicate).length,
    errorCount:     errors.length,
    duplicateCount: duplicates.length,
    fieldErrorCount,
  }
}

function isDuplicate(
  incoming: ParsedTransaction,
  existing: ParsedTransaction[],
): boolean {
  if (!incoming.date || incoming.amount === null) return false
  return existing.some(t =>
    t.date   === incoming.date   &&
    t.amount === incoming.amount &&
    t.description.substring(0, 20) === incoming.description.substring(0, 20)
  )
}

function emptyResult(source: ParseResult['source']): ParseResult {
  return {
    source, total: 0, success: [], errors: [], duplicates: [],
    successCount: 0, errorCount: 0, duplicateCount: 0, fieldErrorCount: 0,
  }
}
