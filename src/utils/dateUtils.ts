// 日期工具函数：纯函数，零副作用
// 第六层 utils，不得调用任何外部服务

/**
 * 将各种日期格式统一转换为 YYYY-MM-DD 字符串
 * 支持：'2024/03/15'、'2024-03-15'、'2024-03-15 14:30:00' 等常见格式
 * @param raw 原始日期字符串
 * @returns 标准 YYYY-MM-DD 字符串，解析失败返回 null
 */
export function toStandardDate(raw: string): string | null {
  if (!raw) return null  // 空值直接返回 null

  // 取前 10 位：适用于 'YYYY-MM-DD HH:mm:ss' 或 'YYYY/MM/DD HH:mm:ss'
  const trimmed = raw.trim().substring(0, 10)

  // 将斜杠统一替换为连字符
  const normalized = trimmed.replace(/\//g, '-')

  // 验证格式：必须符合 YYYY-MM-DD 的形式
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(normalized)) return null  // 格式不匹配，返回 null

  // 验证是否是合法日期（如 2024-02-30 不合法）
  const date = new Date(normalized)
  if (isNaN(date.getTime())) return null  // 无效日期，返回 null

  return normalized  // 返回标准格式
}

/**
 * 将 YYYY-MM-DD 格式的日期转换为中文显示格式
 * 例如：'2024-03-15' → '3月15日'
 * @param dateStr YYYY-MM-DD 格式的日期字符串
 * @returns 中文日期字符串，解析失败返回原始字符串
 */
export function toChineseDate(dateStr: string): string {
  if (!dateStr) return ''

  // 拆分年月日
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr  // 格式不对则原样返回

  const month = parseInt(parts[1], 10)   // 月份去掉前导零
  const day = parseInt(parts[2], 10)     // 日期去掉前导零
  return `${month}月${day}日`            // 拼接中文格式
}

/**
 * 获取指定日期所在月份的起止日期字符串
 * 用于月度账单筛选
 * @param year  年份，如 2024
 * @param month 月份，1-12
 * @returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 */
export function getMonthRange(year: number, month: number): { start: string; end: string } {
  // 月份起始：当月第一天
  const start = `${year}-${String(month).padStart(2, '0')}-01`

  // 月份结束：下月第一天减一天，自动处理大小月和闰年
  const endDate = new Date(year, month, 0)  // month 不减1，Date构造器会自动滚动到上个月末
  const end = endDate.toISOString().substring(0, 10)  // 取 YYYY-MM-DD 部分

  return { start, end }
}

/**
 * 获取当前月份的 YYYY-MM 字符串
 * 用于默认选中本月
 * @returns 如 '2024-03'
 */
export function getCurrentMonth(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')  // 月份从0开始，需+1
  return `${year}-${month}`
}
