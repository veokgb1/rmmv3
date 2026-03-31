// Mock 账单数据中心
// S2 阶段全程使用此文件驱动 UI，严禁替换为真实 Firebase 数据
// 数据类型与 Transaction.types.ts 完全一致，S3 接入真实数据时此文件直接废弃

import type { Transaction } from '@/types/Transaction.types'

// 获取当前年月，用于生成贴近真实的日期数据
const now = new Date()
const thisYear = now.getFullYear()       // 今年年份
const thisMonth = now.getMonth() + 1     // 本月月份（1-12）
// 上个月月份：如果是1月则回退到去年12月
const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1
// 上个月对应的年份：如果本月是1月则年份减1
const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear

// 日期格式化辅助函数：将年月日拼接为 YYYY-MM-DD 字符串
const d = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

// ─────────────────────────────────────────────────────────────
// 核心 Mock 数据：20 条覆盖多分类、多来源、跨两个月的账单记录
// ─────────────────────────────────────────────────────────────
export const MOCK_TRANSACTIONS: Transaction[] = [

  // ── 本月数据（支出类） ──────────────────────────────────────

  {
    id: 'mock-001',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 2),       // 本月2日
    amount: -38.5,                          // 负数=支出
    category: '餐饮',
    description: '美团外卖 · 黄焖鸡米饭',
    source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '美团' },
  },
  {
    id: 'mock-002',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 3),        // 本月3日
    amount: -23.0,
    category: '交通',
    description: '滴滴打车 · 加班返回',
    source: 'alipay',
    rawData: { 交易分类: '交通', 商品说明: '快车' },
  },
  {
    id: 'mock-003',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 5),        // 本月5日
    amount: -1299.0,
    category: '购物',
    description: '京东自营 · 罗技 MX Keys 键盘',
    source: 'alipay',
    rawData: { 交易分类: '购物', 商品说明: '键盘' },
  },
  {
    id: 'mock-004',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 7),        // 本月7日
    amount: -15.0,
    category: '餐饮',
    description: '瑞幸咖啡 · 生椰拿铁',
    source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '瑞幸咖啡' },
  },
  {
    id: 'mock-005',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 8),        // 本月8日
    amount: -6.0,
    category: '交通',
    description: '地铁 · 早高峰通勤',
    source: 'wechat',
    rawData: { 交易类型: '交通', 交易对方: '城市地铁' },
  },
  {
    id: 'mock-006',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 10),       // 本月10日
    amount: -128.0,
    category: '娱乐',
    description: 'Steam · 黑神话悟空 DLC',
    source: 'alipay',
    rawData: { 交易分类: '娱乐', 商品说明: 'Steam 充值' },
  },
  {
    id: 'mock-007',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 12),       // 本月12日
    amount: -2800.0,
    category: '居住',
    description: '房租 · 3月份房租转账',
    source: 'wechat',
    rawData: { 交易类型: '转账', 交易对方: '房东张先生' },
  },
  {
    id: 'mock-008',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 14),       // 本月14日
    amount: -56.0,
    category: '餐饮',
    description: '海底捞 · 工作日午餐',
    source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '海底捞' },
  },
  {
    id: 'mock-009',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 15),       // 本月15日（工资发放日）
    amount: 12500.0,                         // 正数=收入
    category: '工资',
    description: '公司工资 · 3月份薪资',
    source: 'manual',
    rawData: {},
  },
  {
    id: 'mock-010',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 16),       // 本月16日
    amount: -188.0,
    category: '医疗',
    description: '美年大健康 · 年度体检套餐',
    source: 'alipay',
    rawData: { 交易分类: '医疗健康', 商品说明: '体检套餐 A' },
  },
  {
    id: 'mock-011',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 18),       // 本月18日
    amount: -45.0,
    category: '餐饮',
    description: '饿了么 · 沙县小吃外卖',
    source: 'alipay',
    rawData: { 交易分类: '餐饮美食', 商品说明: '外卖订单' },
  },
  {
    id: 'mock-012',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 20),       // 本月20日
    amount: 500.0,                           // 副业收入
    category: '副业收入',
    description: '稿费收入 · 掘金专栏文章',
    source: 'alipay',
    rawData: { 交易分类: '收入', 商品说明: '稿费结算' },
  },
  {
    id: 'mock-013',
    userId: 'mock-user',
    date: d(thisYear, thisMonth, 22),       // 本月22日
    amount: -399.0,
    category: '教育',
    description: '极客时间 · TypeScript 进阶课程',
    source: 'alipay',
    rawData: { 交易分类: '教育培训', 商品说明: '在线课程' },
  },

  // ── 上个月数据（提供历史对比） ────────────────────────────

  {
    id: 'mock-014',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 15),  // 上月15日（工资）
    amount: 12500.0,
    category: '工资',
    description: `公司工资 · ${lastMonth}月份薪资`,
    source: 'manual',
    rawData: {},
  },
  {
    id: 'mock-015',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 20),  // 上月20日
    amount: -89.0,
    category: '购物',
    description: '淘宝 · 冬季保暖内衣套装',
    source: 'alipay',
    rawData: { 交易分类: '购物', 商品说明: '内衣' },
  },
  {
    id: 'mock-016',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 22),  // 上月22日
    amount: -12.0,
    category: '交通',
    description: '共享单车 · 哈啰月卡续费',
    source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '哈啰单车' },
  },
  {
    id: 'mock-017',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 25),  // 上月25日
    amount: -2800.0,
    category: '居住',
    description: `房租 · ${lastMonth}月份房租转账`,
    source: 'wechat',
    rawData: { 交易类型: '转账', 交易对方: '房东张先生' },
  },
  {
    id: 'mock-018',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 26),  // 上月26日
    amount: -62.0,
    category: '餐饮',
    description: '太二酸菜鱼 · 周末聚餐',
    source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '太二酸菜鱼' },
  },
  {
    id: 'mock-019',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 28),  // 上月28日
    amount: -18.0,
    category: '娱乐',
    description: '爱奇艺 · 年度会员续费（月付）',
    source: 'alipay',
    rawData: { 交易分类: '娱乐', 商品说明: '视频会员' },
  },
  {
    id: 'mock-020',
    userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 28),  // 上月28日
    amount: 200.0,                           // 理财收益
    category: '理财收益',
    description: '余额宝 · 月度利息到账',
    source: 'alipay',
    rawData: { 交易分类: '收入', 商品说明: '基金收益' },
  },
]

// ─────────────────────────────────────────────────────────────
// 辅助函数：从 Mock 数据中筛选本月账单
// ─────────────────────────────────────────────────────────────

/** 获取本月 YYYY-MM 前缀字符串，用于日期筛选 */
const currentMonthPrefix = `${thisYear}-${String(thisMonth).padStart(2, '0')}`

/** 本月全部账单（按日期倒序） */
export const MOCK_THIS_MONTH = MOCK_TRANSACTIONS
  .filter(t => t.date.startsWith(currentMonthPrefix))   // 只保留本月记录
  .sort((a, b) => b.date.localeCompare(a.date))          // 日期倒序（最新在前）

/** 本月总收入（所有正数 amount 之和） */
export const MOCK_INCOME = MOCK_THIS_MONTH
  .filter(t => t.amount > 0)                             // 筛选收入条目
  .reduce((sum, t) => sum + t.amount, 0)                 // 求和

/** 本月总支出（所有负数 amount 的绝对值之和，排除转账分类） */
export const MOCK_EXPENSE = MOCK_THIS_MONTH
  .filter(t => t.amount < 0 && t.category !== '转账')   // 筛选支出（排除转账）
  .reduce((sum, t) => sum + Math.abs(t.amount), 0)       // 求绝对值之和
