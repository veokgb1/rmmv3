// 账单解析结果类型定义
// 被 Service 层（parsers）返回，被 Hook 层（useFileImport）消费

import type { Transaction } from './Transaction.types'

// ── 单行解析错误记录 ──────────────────────────────────────────────
/** 解析失败的行的详细信息 */
export interface ParseErrorItem {
  rowIndex: number      // 原文件中的行号（从1开始，方便用户定位）
  rawContent: string    // 失败行的原始文本内容
  reason: string        // 失败原因描述（中文）
}

// ── 解析结果汇总 ──────────────────────────────────────────────────
/**
 * ParseResult — 单次文件解析的完整结果
 * 成功记录、失败记录、重复记录分别收集，不丢失任何数据
 */
export interface ParseResult {
  source: 'wechat' | 'alipay' | 'unknown'  // 识别出的账单来源
  total: number                              // 文件中的数据总行数
  success: Transaction[]                     // 解析成功的账单记录
  errors: ParseErrorItem[]                   // 解析失败的行详情
  duplicates: Transaction[]                  // 疑似重复的记录（已标记 isDuplicate: true）
  successCount: number                       // 成功数量（等于 success.length，方便展示）
  errorCount: number                         // 失败数量（等于 errors.length）
  duplicateCount: number                     // 重复数量
}
