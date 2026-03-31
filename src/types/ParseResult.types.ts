// 账单解析结果类型定义 — S4 版本
// 解析阶段产出的是"待入库"数据，不含 Firestore 系统字段

import type { TransactionSource } from './Transaction.types'

// ── 解析阶段的中间态账单（不含系统字段） ─────────────────────
/**
 * ParsedTransaction — 解析引擎输出的中间态结构
 * 不含 id / ledgerId / userId / createdAt / updatedAt（这些由 Service 层写入时注入）
 * 解析成功即进入此结构，哪怕 amount/date 解析失败也保留条目（用 parseError 标记）
 */
export interface ParsedTransaction {
  // ── 业务字段 ──────────────────────────────────────────────
  date:         string | null          // YYYY-MM-DD，解析失败为 null
  amount:       number | null          // 金额（正收入/负支出），解析失败为 null
  category:     string                 // 一级分类（匹配失败归"未分类"）
  subCategory?: string                 // 二级分类（暂时为空，用户后续手动设置）
  description:  string                 // 交易描述
  source:       TransactionSource      // 数据来源标识

  // ── 来源追踪 ──────────────────────────────────────────────
  rawData:      Record<string, string> // 原始行的完整键值对（永不丢弃）
  rowIndex:     number                 // 在原始文件中的行号（从1计，方便定位）

  // ── 数据质量标记 ───────────────────────────────────────────
  parseError?:  string                 // 解析错误描述（有值=有字段解析失败）
  isDuplicate?: boolean                // 疑似重复标记
}

// ── 单行解析错误记录 ──────────────────────────────────────────
/** 整行无法解析时的错误详情 */
export interface ParseErrorItem {
  rowIndex:   number   // 原文件行号（从1计，方便用户对照原始文件）
  rawContent: string   // 失败行的原始文本（完整保留）
  reason:     string   // 失败原因的中文描述
}

// ── 解析结果汇总 ──────────────────────────────────────────────
/**
 * ParseResult — 单次解析任务的完整结果报告
 * 成功 / 失败 / 重复 三类数据分别收集，保证数据完整不丢失
 */
export interface ParseResult {
  source:         'wechat' | 'alipay' | 'unknown'  // 识别出的账单来源
  total:          number                             // 原始文件中的数据总行数
  success:        ParsedTransaction[]                // 解析成功的条目（含有字段级错误的也在此）
  errors:         ParseErrorItem[]                   // 整行无法解析的条目
  duplicates:     ParsedTransaction[]                // 疑似重复的条目（已标记 isDuplicate）
  successCount:   number                             // 无任何错误的干净条目数量
  errorCount:     number                             // 整行失败数量
  duplicateCount: number                             // 疑似重复数量
  fieldErrorCount: number                            // 有字段级错误（parseError）的条目数量
}
