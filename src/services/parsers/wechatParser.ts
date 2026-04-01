// 微信账单 CSV 解析器 — S4 战略升级版
// 严格按照 SKILL_DATA_PARSING.md 的 STEP 1-7 执行
// 新增：tags / accountId / sourceType / originalParsedData 字段填充

import type { ParsedTransaction, ParseResult, ParseErrorItem } from '@/types/ParseResult.types'
import { mapCategory, parseAmount, parseDate, parseCsvLine, buildRowMap } from './parseUtils'
import { guessAccountId } from '@/types/Account.types'

// ── 微信账单的元数据行数 ──────────────────────────────────────
// 微信导出的 CSV：前16行是说明文字，第17行是表头，第18行起是数据
const WECHAT_SKIP_ROWS = 16

// ── 微信账单表头字段名（原始中文，不可改） ───────────────────
const COL = {
  TIME:        '交易时间',
  TYPE:        '交易类型',
  COUNTERPART: '交易对方',
  GOODS:       '商品',
  IO:          '收/支',
  AMOUNT:      '金额(元)',
  METHOD:      '支付方式',
  STATUS:      '当前状态',
  REMARK:      '备注',
} as const

/**
 * parseWechat — 解析微信支付账单 CSV 文本
 *
 * @param rawText 从微信导出的完整 CSV 文本（含元数据头）
 * @param existingTransactions 已存在的账单（用于重复检测），默认空数组
 * @returns ParseResult 完整解析结果
 */
export function parseWechat(
  rawText: string,
  existingTransactions: ParsedTransaction[] = [],
): ParseResult {
  // 将整个文本按行分割（兼容 \r\n 和 \n 两种换行符）
  const lines = rawText.split(/\r?\n/)

  // STEP 2：跳过前16行元数据，第17行（index=16）是表头
  const headerLine = lines[WECHAT_SKIP_ROWS]
  if (!headerLine) {
    // 文件行数不足，说明不是合法的微信账单
    return emptyResult('wechat')
  }

  // 解析表头行，得到字段名数组
  const headers = parseCsvLine(headerLine)

  // 数据行从第18行（index=17）开始
  const dataLines = lines.slice(WECHAT_SKIP_ROWS + 1)

  // ── 初始化结果容器 ─────────────────────────────────────────
  const success:    ParsedTransaction[] = []
  const errors:     ParseErrorItem[]    = []
  const duplicates: ParsedTransaction[] = []
  let fieldErrorCount = 0   // 有字段级错误的条目计数

  // ── 逐行处理 ───────────────────────────────────────────────
  dataLines.forEach((line, index) => {
    const rowIndex = WECHAT_SKIP_ROWS + 2 + index  // 在原始文件中的真实行号（从1计）

    // 跳过空行（文件末尾通常有空行）
    if (!line.trim()) return

    // 跳过"合计"汇总行（微信账单末尾有汇总行）
    if (line.includes('合计') || line.includes('本月')) return

    let values: string[]
    try {
      values = parseCsvLine(line)   // 解析单行 CSV
    } catch {
      // 整行连 CSV 都无法解析，记录为错误行
      errors.push({ rowIndex, rawContent: line, reason: 'CSV 格式解析失败' })
      return
    }

    // 字段数量不匹配（可能是数据损坏）
    if (values.length < headers.length - 2) {
      errors.push({ rowIndex, rawContent: line, reason: `字段数量不足（期望≥${headers.length - 2}，实际${values.length}）` })
      return
    }

    // STEP 3：将表头和值组合为键值对对象
    const row = buildRowMap(headers, values)
    const rawData = { ...row }   // 保存完整原始数据

    // STEP 3 + STEP 4：字段映射与金额解析
    const date   = parseDate(row[COL.TIME])          // 交易时间 → 标准日期
    const amount = parseAmount(row[COL.AMOUNT], row[COL.IO])  // 金额(元) + 收/支 → 数字

    // STEP 3：拼接描述（优先商品，其次交易对方）
    const description = [row[COL.GOODS], row[COL.COUNTERPART]]
      .filter(Boolean)            // 过滤空字段
      .join(' · ')                // 用间隔点连接
      .trim() || '（无描述）'     // 兜底文字

    // STEP 5：自动分类
    const category = mapCategory(row[COL.TYPE], row[COL.GOODS], row[COL.COUNTERPART])

    // 记录字段级解析错误（但不丢弃该条目）
    const parseErrors: string[] = []
    if (date   === null) parseErrors.push('DATE_PARSE_FAILED')
    if (amount === null) parseErrors.push('AMOUNT_PARSE_FAILED')

    // 战略支柱①：从"支付方式"字段推断资金账户 ID
    const accountId = guessAccountId(row[COL.METHOD])

    // 首次解析结果快照（写入 originalParsedData，后续人工修正后仍可追溯）
    const originalParsedData: Record<string, unknown> = {
      date,                          // 解析器识别的日期
      amount,                        // 解析器识别的金额
      category,                      // 解析器自动分类结果
      description,                   // 解析器拼接的描述
      accountId,                     // 解析器推断的账户
    }

    const tx: ParsedTransaction = {
      // ── 业务核心字段 ────────────────────────────────────────
      date,
      amount,
      category,
      description,
      // ── 战略支柱①：标签与资金账户 ──────────────────────────
      tags:      [],         // CSV 解析阶段无法推断标签，留空等待用户补充
      accountId,             // 根据支付方式字段自动推断
      // ── 战略支柱②：录入方式与溯源 ──────────────────────────
      sourceType:          'csv',     // 本批次为 CSV 粘贴导入
      source:              'wechat',  // 数据平台：微信支付
      rawData,                        // 原始 CSV 行数据（永不覆盖）
      originalParsedData,             // 解析器首次输出快照（人工修正后仍可查）
      // ── OCR 字段（CSV 来源全部为默认值）────────────────────
      ocrConfidence: 1,    // CSV 来源不涉及 OCR，置信度视为完美
      ocrDoubtSpans: [],   // CSV 来源无存疑区域
      rowIndex,
      parseError: parseErrors.length > 0 ? parseErrors.join(',') : undefined,
    }

    // 有字段错误则计数，但仍加入 success（用户可手动修正）
    if (parseErrors.length > 0) fieldErrorCount++

    // STEP 7：重复检测（与本批次已处理条目 + 历史记录对比）
    const allExisting = [...existingTransactions, ...success]
    if (isDuplicate(tx, allExisting)) {
      tx.isDuplicate = true
      duplicates.push(tx)   // 疑似重复单独收集
    }

    success.push(tx)   // 无论是否重复，都加入成功列表
  })

  return {
    source:         'wechat',
    total:          dataLines.filter(l => l.trim()).length,
    success,
    errors,
    duplicates,
    successCount:   success.filter(t => !t.parseError && !t.isDuplicate).length,
    errorCount:     errors.length,
    duplicateCount: duplicates.length,
    fieldErrorCount,
  }
}

// ── 辅助函数 ──────────────────────────────────────────────────

/**
 * isDuplicate — 基于三元组检测疑似重复
 * 三元组：(date, amount, description 前20字)
 */
function isDuplicate(
  incoming: ParsedTransaction,
  existing: ParsedTransaction[],
): boolean {
  if (!incoming.date || incoming.amount === null) return false  // 日期或金额为空不做重复检测

  return existing.some(t =>
    t.date   === incoming.date   &&    // 同日期
    t.amount === incoming.amount &&    // 同金额
    t.description.substring(0, 20) === incoming.description.substring(0, 20)  // 描述相似
  )
}

/**
 * emptyResult — 返回空结果（用于格式不匹配的兜底）
 */
function emptyResult(source: ParseResult['source']): ParseResult {
  return {
    source, total: 0, success: [], errors: [], duplicates: [],
    successCount: 0, errorCount: 0, duplicateCount: 0, fieldErrorCount: 0,
  }
}
