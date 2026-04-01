// 账单解析结果类型定义 — S4 战略升级版
// ParsedTransaction 同步加入三大战略支柱的新字段

import type { TransactionSource, SourceType, OcrStatus, OcrDoubtSpan } from './Transaction.types'

// ════════════════════════════════════════════════════════════
// § 1  解析阶段的中间态账单
// ════════════════════════════════════════════════════════════

/**
 * ParsedTransaction — 解析引擎输出的中间态结构
 *
 * 不含 Firestore 系统字段（id / ledgerId / userId / createdAt / updatedAt）
 * 这些字段由 Service 层在写入数据库时注入。
 *
 * 与 Transaction 的关系：
 *   ParsedTransaction ──[Service 层注入系统字段]──▶ Transaction
 */
export interface ParsedTransaction {

  // ── 业务核心字段 ───────────────────────────────────────────
  date:         string | null   // YYYY-MM-DD，解析失败为 null
  amount:       number | null   // 金额（正收入/负支出），解析失败为 null
  category:     string          // 一级分类（匹配失败归"未分类"）
  subCategory?: string          // 二级分类（解析阶段留空，用户后续设置）
  description:  string          // 交易描述/备注

  // ── 战略支柱①：多维标签 ───────────────────────────────────
  /**
   * tags — 多维标签（解析阶段默认空数组，用户在 UI 中后续补充）
   * CSV 解析时无法自动推断标签，但预留此字段是为了：
   *   1. 保持与 Transaction 类型结构一致，Service 层转换时零改动
   *   2. 未来 OCR 阶段 AI 可从单据内容自动打标
   */
  tags: string[]

  // ── 战略支柱①：资金账户 ───────────────────────────────────
  /**
   * accountId — 资金账户 ID（CSV 解析时通过 guessAccountId() 自动推断）
   * 推断失败时填入 'acc-unknown'
   */
  accountId: string

  // ── 战略支柱②：录入方式 ───────────────────────────────────
  /** sourceType — 本批次的录入方式（CSV 解析时固定为 'csv'） */
  sourceType: SourceType

  /** source — 数据平台来源（wechat / alipay 等） */
  source: TransactionSource

  // ── 溯源与留档 ─────────────────────────────────────────────
  /**
   * rawData — 原始行的完整键值对（永不丢弃，任何情况下不覆盖）
   * CSV 来源：原始 CSV 行的所有列名→值映射
   * OCR 来源：OCR 引擎返回的原始字段识别结果
   */
  rawData: Record<string, string>

  /**
   * originalParsedData — 解析器【首次输出结果】的存档
   * 记录解析引擎对 rawData 的第一次解读（包括金额转换、日期标准化等）
   * 用户修正后，此字段依然保留，用于：
   *   1. 展示"查看 AI 原始判断"
   *   2. 统计解析准确率
   *   3. OCR 模型迭代优化
   */
  originalParsedData: Record<string, unknown>

  /** rowIndex — 在原始文件中的行号（从1计，方便用户对照原始文件） */
  rowIndex: number

  // ── 战略支柱②：OCR 专用字段（CSV 解析时均为默认值）── ──
  /** ocrStatus — OCR 工作流状态（CSV 来源时为 undefined） */
  ocrStatus?: OcrStatus

  /** ocrConfidence — 整体置信度（CSV 来源时为 1，表示完全可信） */
  ocrConfidence?: number

  /** ocrDoubtSpans — 字段级存疑区域（CSV 来源时为空数组） */
  ocrDoubtSpans?: OcrDoubtSpan[]

  // ── 数据质量标记 ───────────────────────────────────────────
  parseError?:  string    // 字段级解析错误描述
  isDuplicate?: boolean   // 疑似重复标记
}

// ════════════════════════════════════════════════════════════
// § 2  解析辅助类型
// ════════════════════════════════════════════════════════════

/** 整行无法解析时的错误详情 */
export interface ParseErrorItem {
  rowIndex:   number   // 原文件行号（从1计）
  rawContent: string   // 失败行的原始文本（完整保留）
  reason:     string   // 失败原因（中文描述）
}

// ════════════════════════════════════════════════════════════
// § 3  解析结果汇总
// ════════════════════════════════════════════════════════════

/**
 * ParseResult — 单次解析任务的完整结果报告
 * 成功 / 失败 / 重复 三类数据分别收集，保证数据完整不丢失
 */
export interface ParseResult {
  source:          'wechat' | 'alipay' | 'unknown'
  total:           number                    // 原始数据总行数
  success:         ParsedTransaction[]       // 解析成功条目（含字段级错误）
  errors:          ParseErrorItem[]          // 整行无法解析的条目
  duplicates:      ParsedTransaction[]       // 疑似重复（已标记 isDuplicate）
  successCount:    number                    // 干净成功（无任何错误）数量
  errorCount:      number                    // 整行失败数量
  duplicateCount:  number                    // 疑似重复数量
  fieldErrorCount: number                    // 字段级错误数量
}
