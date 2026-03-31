// 金额工具函数：纯函数，零副作用
// 第六层 utils，统一处理所有金额的显示格式

/**
 * 将数字格式化为带货币符号的中文显示格式
 * 例如：-1234.5 → '¥ 1,234.50'（不含符号，需调用方判断正负）
 * @param amount 金额数字（正=收入，负=支出）
 * @returns 格式化后的字符串，带千分符和两位小数
 */
export function formatAmount(amount: number): string {
  if (amount === null || amount === undefined) return '--'  // 无效值显示占位符

  // 取绝对值用于显示，正负由调用方通过颜色区分
  const abs = Math.abs(amount)

  // 使用 Intl.NumberFormat 实现千分位格式化
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,   // 最少保留两位小数
    maximumFractionDigits: 2,   // 最多保留两位小数
  }).format(abs)
}

/**
 * 将金额格式化为带 ¥ 符号和千分符的完整显示字符串
 * 正数（收入）：'+¥ 1,234.50'
 * 负数（支出）：'-¥ 1,234.50'
 * @param amount 金额数字
 * @param showSign 是否显示 +/- 符号，默认 true
 * @returns 完整格式化字符串
 */
export function formatAmountWithSign(amount: number, showSign = true): string {
  if (amount === null || amount === undefined) return '¥ --'

  const formatted = formatAmount(amount)                 // 获取绝对值格式化结果
  const sign = showSign ? (amount >= 0 ? '+' : '-') : '' // 根据参数决定是否加符号
  return `${sign}¥ ${formatted}`                         // 拼接最终字符串
}

/**
 * 将原始金额字符串（可能含 ¥ 符号、逗号）解析为数字
 * 例如：'¥1,234.50' → 1234.5，'支出 ¥99.00' → 99
 * @param raw 原始金额字符串
 * @returns 解析后的浮点数，失败返回 null
 */
export function parseRawAmount(raw: string): number | null {
  if (!raw) return null

  // 去除所有非数字字符（保留小数点）
  const cleaned = raw.replace(/[¥￥$,\s元]/g, '').trim()
  const num = parseFloat(cleaned)  // 转为浮点数

  // 检查解析结果是否为有效数字
  return isNaN(num) ? null : num
}
