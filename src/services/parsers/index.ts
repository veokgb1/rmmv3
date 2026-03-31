// 解析引擎主入口
// 接收原始文本，自动识别来源，分派到对应解析器，返回统一结果

import type { ParseResult } from '@/types/ParseResult.types'
import { parseWechat }  from './wechatParser'
import { parseAlipay }  from './alipayParser'

// ── 来源识别特征字符串（STEP 1） ─────────────────────────────
// 读取文件前 300 个字符即可识别，避免读取整个大文件
const WECHAT_FINGERPRINT = '微信支付账单明细'
const ALIPAY_FINGERPRINT = '支付宝交易记录明细'

/**
 * detectSource — 识别账单文本的来源
 * @param rawText 原始文本（只需前300字符）
 * @returns 来源标识
 */
export function detectSource(rawText: string): 'wechat' | 'alipay' | 'unknown' {
  const preview = rawText.substring(0, 300)    // 只看前300字符，足够识别特征
  if (preview.includes(WECHAT_FINGERPRINT))  return 'wechat'
  if (preview.includes(ALIPAY_FINGERPRINT))  return 'alipay'
  return 'unknown'
}

/**
 * parseBillText — 解析账单文本的统一入口函数
 *
 * 使用方式（S4 纯前端阶段）：
 *   const result = parseBillText(csvText)
 *   console.log(result.success)   // 解析成功的条目
 *   console.log(result.errors)    // 解析失败的行
 *
 * @param rawText 原始账单文本（CSV 格式，含元数据头）
 * @param source  可手动指定来源；不传则自动识别
 * @returns ParseResult 完整解析结果
 */
export function parseBillText(
  rawText: string,
  source?: 'wechat' | 'alipay',
): ParseResult {
  // 自动识别来源（若调用方未指定）
  const detectedSource = source ?? detectSource(rawText)

  // 根据来源分派到对应解析器
  switch (detectedSource) {
    case 'wechat':
      return parseWechat(rawText)   // 分派到微信解析器

    case 'alipay':
      return parseAlipay(rawText)   // 分派到支付宝解析器

    default:
      // 来源未知：返回错误结果，提示用户手动选择
      return {
        source:         'unknown',
        total:          0,
        success:        [],
        errors:         [{ rowIndex: 0, rawContent: rawText.substring(0, 100), reason: '无法识别账单来源，请确认是否为微信或支付宝导出的CSV文件' }],
        duplicates:     [],
        successCount:   0,
        errorCount:     1,
        duplicateCount: 0,
        fieldErrorCount: 0,
      }
  }
}
