// 解析公共工具函数
// 被 wechatParser / alipayParser 共同调用，不含任何业务特定逻辑

// ── 分类关键词映射表（优先级从上到下） ───────────────────────
// 遇到匹配即停止，越靠前优先级越高
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '工资':     ['工资', '薪资', '薪酬', '发薪', '月薪'],
  '转账':     ['转账', '红包', '退款', '退还'],
  '餐饮':     ['美团', '饿了么', '麦当劳', '肯德基', '星巴克', '必胜客',
               '海底捞', '外卖', '餐厅', '食堂', '奶茶', '瑞幸', '咖啡',
               '火锅', '烧烤', '快餐', '饭店', '酒楼', '太二'],
  '交通':     ['滴滴', '高德', '地铁', '公交', '加油', '停车', '高铁',
               '飞机', '机票', '打车', '出行', '共享单车', '哈啰', '嘀嗒',
               '曹操出行', '神州', 'ETC'],
  '购物':     ['淘宝', '天猫', '京东', '拼多多', '超市', '便利店', '沃尔玛',
               '盒马', '亚马逊', '苏宁', '国美', '唯品会', '得物'],
  '娱乐':     ['爱奇艺', '优酷', '腾讯视频', '网易云', 'B站', 'bilibili',
               'Steam', '游戏', '电影', 'KTV', '网吧', '密室', '剧本杀',
               'Apple TV', 'Netflix', 'YouTube'],
  '医疗':     ['医院', '药店', '诊所', '体检', '药房', '卫生院', '牙科',
               '眼科', '美年', '艾尔'],
  '居住':     ['房租', '水费', '电费', '燃气', '物业', '宽带', '网费',
               '房东', '租金', '天然气'],
  '教育':     ['学费', '书本', '课程', '培训', '知乎', '得到', '慕课',
               '网课', '辅导', '补习', '极客时间'],
  '副业收入': ['稿费', '版税', '佣金', '分红', '奖金', '兼职'],
  '理财收益': ['余额宝', '基金', '利息', '收益', '股票', '分红', '定期'],
}

/**
 * mapCategory — 自动匹配一级分类
 * 将多个文本来源合并后，逐条对比关键词表，返回第一个匹配的分类
 * @param texts 需要参与匹配的文本片段（可传多个，如交易类型+商品描述）
 * @returns 匹配的一级分类名称，无匹配则返回"未分类"
 */
export function mapCategory(...texts: (string | undefined | null)[]): string {
  // 将所有文本片段合并为一个字符串，统一匹配
  const combined = texts
    .filter(Boolean)           // 过滤 null / undefined / 空字符串
    .join(' ')                 // 用空格连接
    .toLowerCase()             // 统一转小写，避免大小写不一致

  // 按优先级顺序遍历映射表
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    // 只要有一个关键词命中，立即返回对应分类
    if (keywords.some(kw => combined.includes(kw.toLowerCase()))) {
      return category
    }
  }

  return '未分类'  // 所有关键词均未命中，归入未分类
}

/**
 * parseAmount — 解析金额字符串为数字
 * 自动处理货币符号、逗号千分符、前后空白等脏数据
 * @param rawAmount 原始金额字符串，如 "¥1,234.50" 或 "38.00"
 * @param direction 收支方向文字，含"支出"则取负数，否则取正数
 * @returns 解析后的浮点数，失败返回 null
 */
export function parseAmount(
  rawAmount: string | undefined | null,
  direction: string | undefined | null,
): number | null {
  if (!rawAmount) return null  // 空值直接失败

  // 去除所有货币符号、逗号、空白字符，只保留数字和小数点
  const cleaned = rawAmount.replace(/[¥￥$,，\s元]/g, '').trim()

  // 处理空括号或特殊符号（部分银行用括号表示负数，如 "(38.00)"）
  const unwrapped = cleaned.replace(/^\((.+)\)$/, '-$1')

  const num = parseFloat(unwrapped)   // 转为浮点数

  // NaN 说明字符串不是有效数字
  if (isNaN(num)) return null

  // 根据方向决定符号：含"支出"/"借"/"付款"则为负数
  const isExpense = /支出|借|付款|转出/.test(direction ?? '')
  return isExpense ? -Math.abs(num) : Math.abs(num)
}

/**
 * parseDate — 解析各种格式的日期字符串为标准 YYYY-MM-DD
 * 支持：
 *   "2024-03-15 14:30:22"  → "2024-03-15"
 *   "2024/03/15 14:30:22"  → "2024-03-15"
 *   "2024年03月15日"        → "2024-03-15"
 * @param raw 原始日期字符串
 * @returns 标准 YYYY-MM-DD 字符串，解析失败返回 null
 */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null

  // 尝试直接截取前10位（适用于 "YYYY-MM-DD xxx" 格式）
  const sliced = raw.trim().substring(0, 10)
    .replace(/\//g, '-')   // 斜杠统一转连字符
    .replace(/年/g, '-')   // 中文年转连字符
    .replace(/月/g, '-')   // 中文月转连字符
    .replace(/日/g, '')    // 去除中文日

  // 验证格式：必须是 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sliced)) return null

  // 验证日期合法性（如 2024-02-30 不合法）
  const date = new Date(sliced)
  if (isNaN(date.getTime())) return null

  return sliced  // 返回标准格式
}

/**
 * parseCsvLine — 解析单行 CSV 文本为字段数组
 * 处理带引号的字段（字段内可包含逗号），以及 UTF-8 BOM 头
 * @param line 单行 CSV 文本
 * @returns 字段字符串数组
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''          // 当前正在处理的字段内容
  let inQuotes = false      // 是否在引号包裹的字段内

  // 去除 UTF-8 BOM（微信账单文件常有此前缀）
  const cleaned = line.replace(/^\uFEFF/, '')

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]

    if (char === '"') {
      // 处理双引号转义（"" 表示字段内的一个引号字符）
      if (inQuotes && cleaned[i + 1] === '"') {
        current += '"'   // 写入一个引号字符
        i++              // 跳过下一个引号
      } else {
        inQuotes = !inQuotes  // 切换引号状态
      }
    } else if (char === ',' && !inQuotes) {
      // 逗号且不在引号内：字段分隔符
      fields.push(current.trim())  // 推入字段（去除首尾空白）
      current = ''                 // 重置当前字段
    } else {
      current += char  // 普通字符，追加到当前字段
    }
  }

  // 推入最后一个字段（循环结束后 current 中还有内容）
  fields.push(current.trim())

  return fields
}

/**
 * buildRowMap — 将表头数组和数据数组组合为键值对对象
 * @param headers 表头字段名数组
 * @param values  对应的值数组
 * @returns Record<字段名, 值>
 */
export function buildRowMap(
  headers: string[],
  values:  string[],
): Record<string, string> {
  const map: Record<string, string> = {}
  headers.forEach((header, i) => {
    // 去除表头和值的首尾空白及 BOM 字符
    const key = header.trim().replace(/^\uFEFF/, '')
    map[key] = (values[i] ?? '').trim()
  })
  return map
}
