// 金额工具函数：纯函数，零副作用
// 第六层 utils，统一处理所有金额的显示格式
// V2 升级：formatAmount 支持可选 currencyCode，自动映射货币符号

// ── 货币符号映射表 ─────────────────────────────────────────────
// 键为 ISO 4217 货币代码，值为对应的显示符号
export const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',     // 人民币
  CAD: 'CA$',   // 加拿大元
  USD: 'US$',   // 美元
  HKD: 'HK$',   // 港元
  EUR: '€',     // 欧元
  GBP: '£',     // 英镑
  JPY: '¥',     // 日元（与人民币同符号）
  KRW: '₩',     // 韩元
  AUD: 'AU$',   // 澳大利亚元
  SGD: 'S$',    // 新加坡元
}

/**
 * 根据 ISO 4217 货币代码返回货币符号
 * @param code 货币代码（大小写不敏感）
 * @returns 对应符号，未知货币返回代码本身
 */
export function getCurrencySymbol(code?: string): string {
  if (!code) return '¥'                               // 默认人民币
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code // 未知货币退化为代码展示
}

/**
 * 将数字格式化为带千分符的金额字符串（不含货币符号）
 * 例如：-1234.5 → '1,234.50'（绝对值显示，正负由调用方通过颜色区分）
 *
 * @param amount       金额数字（正=收入，负=支出）
 * @param currencyCode 可选 ISO 4217 货币代码（仅影响小数位数，如 JPY/KRW 为 0 位）
 * @returns 格式化后的字符串
 */
export function formatAmount(amount: number, currencyCode?: string): string {
  if (amount === null || amount === undefined) return '--'  // 无效值显示占位符

  const abs  = Math.abs(amount)
  const code = currencyCode?.toUpperCase()

  // 日元、韩元等整数货币不显示小数
  const noDecimal = code === 'JPY' || code === 'KRW'

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: noDecimal ? 0 : 2,
    maximumFractionDigits: noDecimal ? 0 : 2,
  }).format(abs)
}

/**
 * 将金额格式化为带货币符号和千分符的完整显示字符串
 * 正数（收入）：'+¥1,234.50'
 * 负数（支出）：'-¥1,234.50'
 *
 * @param amount       金额数字
 * @param showSign     是否显示 +/- 符号，默认 true
 * @param currencyCode 可选 ISO 4217 货币代码（CNY/CAD/USD/HKD/EUR 等）
 * @returns 完整格式化字符串
 */
export function formatAmountWithSign(
  amount:       number,
  showSign      = true,
  currencyCode?: string,
): string {
  if (amount === null || amount === undefined) return `${getCurrencySymbol(currencyCode)} --`

  const formatted = formatAmount(amount, currencyCode)              // 获取绝对值格式化结果
  const symbol    = getCurrencySymbol(currencyCode)                 // 货币符号
  const sign      = showSign ? (amount >= 0 ? '+' : '-') : ''      // 正负前缀
  return `${sign}${symbol}${formatted}`                             // 拼接最终字符串
}

/**
 * 将原始金额字符串（可能含各种货币符号、逗号）解析为数字
 * 例如：'¥1,234.50' → 1234.5，'CA$99.00' → 99，'€1.200,50' → 1200.5
 *
 * @param raw 原始金额字符串
 * @returns 解析后的浮点数，失败返回 null
 */
export function parseRawAmount(raw: string): number | null {
  if (!raw) return null

  // 去除所有货币符号、千分符、空格（保留小数点和负号）
  const cleaned = raw
    .replace(/[¥￥$€£₩CA$AU$HK$S$US$,\s元]/g, '')
    .replace(/[^\d.\-]/g, '')
    .trim()

  const num = parseFloat(cleaned)  // 转为浮点数
  return isNaN(num) ? null : num   // 检查是否为有效数字
}
