// Mock 账单数据中心 — S7 升级版
// 新增：所有记录补齐 Transaction 必填字段（ledgerId / tags / accountId / sourceType / createdAt / updatedAt）
// 三套账本数据分布：personal（12条）/ ledger-elderly（4条）/ mingpao-ca（4条）

import type { Transaction } from '@/types/Transaction.types'

// 时间辅助
const now        = new Date()
const thisYear   = now.getFullYear()
const thisMonth  = now.getMonth() + 1
const lastMonth  = thisMonth === 1 ? 12 : thisMonth - 1
const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear

const d = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

// 固定基准时间戳（避免每次渲染重新生成导致 Zustand 重复初始化）
const BASE_TS = 1711900800000  // 2024-04-01 00:00:00 UTC

// ─────────────────────────────────────────────────────────────
// 全量 Mock 数据（20 条，已补齐所有 Transaction 必填字段）
//
// 账套分布：
//   personal       ─ mock-001～009, mock-014～016（12 条，日常个人）
//   ledger-elderly ─ mock-010, mock-011, mock-017, mock-018（4 条，长者日常）
//   mingpao-ca     ─ mock-012, mock-013, mock-019, mock-020（4 条，专业收支）
// ─────────────────────────────────────────────────────────────
export const MOCK_TRANSACTIONS: Transaction[] = [

  // ══════════════════════════════════════════════════════════
  // 账套：personal（个人日常）
  // ══════════════════════════════════════════════════════════

  {
    id: 'mock-001', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 2),
    amount: -38.5,
    category: '餐饮', description: '美团外卖 · 黄焖鸡米饭',
    tags: ['外卖', '午餐'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '美团' },
    originalParsedData: { category: '餐饮', amount: -38.5 },
  },
  {
    id: 'mock-002', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 3),
    amount: -23.0,
    category: '交通', description: '滴滴打车 · 加班返回',
    tags: ['打车', '加班'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '交通', 商品说明: '快车' },
    originalParsedData: { category: '交通', amount: -23.0 },
  },
  {
    id: 'mock-003', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 5),
    amount: -1299.0,
    category: '购物', description: '京东自营 · 罗技 MX Keys 键盘',
    tags: ['数码', '办公'], accountId: 'acc-alipay-huabei',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '购物', 商品说明: '键盘' },
    originalParsedData: { category: '购物', amount: -1299.0 },
  },
  {
    id: 'mock-004', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 7),
    amount: -15.0,
    category: '餐饮', description: '瑞幸咖啡 · 生椰拿铁',
    tags: ['咖啡'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '瑞幸咖啡' },
    originalParsedData: { category: '餐饮', amount: -15.0 },
  },
  {
    id: 'mock-005', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 8),
    amount: -6.0,
    category: '交通', description: '地铁 · 早高峰通勤',
    tags: ['通勤'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '交通', 交易对方: '城市地铁' },
    originalParsedData: { category: '交通', amount: -6.0 },
  },
  {
    id: 'mock-006', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 10),
    amount: -128.0,
    category: '娱乐', description: 'Steam · 黑神话悟空 DLC',
    tags: ['游戏'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '娱乐', 商品说明: 'Steam 充值' },
    originalParsedData: { category: '娱乐', amount: -128.0 },
  },
  {
    id: 'mock-007', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 12),
    amount: -2800.0,
    category: '居住', description: '房租 · 月份房租转账',
    tags: ['房租', '固定支出'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '转账', 交易对方: '房东张先生' },
    originalParsedData: { category: '居住', amount: -2800.0 },
  },
  {
    id: 'mock-008', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 14),
    amount: -56.0,
    category: '餐饮', description: '海底捞 · 工作日午餐',
    tags: ['聚餐'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '海底捞' },
    originalParsedData: { category: '餐饮', amount: -56.0 },
  },
  {
    id: 'mock-009', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(thisYear, thisMonth, 15),
    amount: 12500.0,
    category: '工资', description: '公司工资 · 月份薪资',
    tags: ['薪资'], accountId: 'acc-wechat-card',
    sourceType: 'manual', source: 'manual',
    rawData: {},
    originalParsedData: { category: '工资', amount: 12500.0 },
  },
  {
    id: 'mock-014', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 15),
    amount: 12500.0,
    category: '工资', description: `公司工资 · ${lastMonth}月份薪资`,
    tags: ['薪资'], accountId: 'acc-wechat-card',
    sourceType: 'manual', source: 'manual',
    rawData: {},
    originalParsedData: { category: '工资', amount: 12500.0 },
  },
  {
    id: 'mock-015', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 20),
    amount: -89.0,
    category: '购物', description: '淘宝 · 冬季保暖内衣套装',
    tags: ['服装'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '购物', 商品说明: '内衣' },
    originalParsedData: { category: '购物', amount: -89.0 },
  },
  {
    id: 'mock-016', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'personal', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 22),
    amount: -12.0,
    category: '交通', description: '共享单车 · 哈啰月卡续费',
    tags: ['通勤'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '哈啰单车' },
    originalParsedData: { category: '交通', amount: -12.0 },
  },

  // ══════════════════════════════════════════════════════════
  // 账套：ledger-elderly（特定长者专属）
  // ══════════════════════════════════════════════════════════

  {
    id: 'mock-010', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'ledger-elderly', userId: 'mock-user',
    date: d(thisYear, thisMonth, 16),
    amount: -188.0,
    category: '医疗', description: '美年大健康 · 年度体检套餐',
    tags: ['体检', '年度'], accountId: 'acc-wechat-card',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '医疗健康', 商品说明: '体检套餐 A' },
    originalParsedData: { category: '医疗', amount: -188.0 },
  },
  {
    id: 'mock-011', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'ledger-elderly', userId: 'mock-user',
    date: d(thisYear, thisMonth, 18),
    amount: -45.0,
    category: '餐饮', description: '饿了么 · 营养餐外卖',
    tags: ['外卖', '午餐'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '餐饮美食', 商品说明: '外卖订单' },
    originalParsedData: { category: '餐饮', amount: -45.0 },
  },
  {
    id: 'mock-017', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'ledger-elderly', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 25),
    amount: -2800.0,
    category: '居住', description: `房租 · ${lastMonth}月份房租转账`,
    tags: ['房租', '固定支出'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '转账', 交易对方: '房东张先生' },
    originalParsedData: { category: '居住', amount: -2800.0 },
  },
  {
    id: 'mock-018', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'ledger-elderly', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 26),
    amount: -62.0,
    category: '餐饮', description: '太二酸菜鱼 · 周末聚餐',
    tags: ['聚餐'], accountId: 'acc-wechat-balance',
    sourceType: 'csv', source: 'wechat',
    rawData: { 交易类型: '商户消费', 交易对方: '太二酸菜鱼' },
    originalParsedData: { category: '餐饮', amount: -62.0 },
  },

  // ══════════════════════════════════════════════════════════
  // 账套：mingpao-ca（Ming Pao Canada 专业账套）
  // ══════════════════════════════════════════════════════════

  {
    id: 'mock-012', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'mingpao-ca', userId: 'mock-user',
    date: d(thisYear, thisMonth, 20),
    amount: 500.0,
    category: '副业收入', description: '稿费收入 · 专栏文章',
    tags: ['稿费', '写作'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '收入', 商品说明: '稿费结算' },
    originalParsedData: { category: '副业收入', amount: 500.0 },
  },
  {
    id: 'mock-013', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'mingpao-ca', userId: 'mock-user',
    date: d(thisYear, thisMonth, 22),
    amount: -399.0,
    category: '教育', description: '极客时间 · TypeScript 进阶课程',
    tags: ['学习', '技术'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '教育培训', 商品说明: '在线课程' },
    originalParsedData: { category: '教育', amount: -399.0 },
  },
  {
    id: 'mock-019', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'mingpao-ca', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 28),
    amount: -18.0,
    category: '娱乐', description: '爱奇艺 · 年度会员续费（月付）',
    tags: ['订阅', '影视'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '娱乐', 商品说明: '视频会员' },
    originalParsedData: { category: '娱乐', amount: -18.0 },
  },
  {
    id: 'mock-020', createdAt: BASE_TS, updatedAt: BASE_TS,
    ledgerId: 'mingpao-ca', userId: 'mock-user',
    date: d(lastMonthYear, lastMonth, 28),
    amount: 200.0,
    category: '理财收益', description: '余额宝 · 月度利息到账',
    tags: ['理财', '被动收入'], accountId: 'acc-alipay-balance',
    sourceType: 'csv', source: 'alipay',
    rawData: { 交易分类: '收入', 商品说明: '基金收益' },
    originalParsedData: { category: '理财收益', amount: 200.0 },
  },
]

// ─────────────────────────────────────────────────────────────
// 辅助函数（保持向后兼容，HomePage 迁移到 useBills 后可移除）
// ─────────────────────────────────────────────────────────────

const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

/** 本月全量账单（含所有账套，仅供初始化 billStore 使用） */
export const MOCK_THIS_MONTH = MOCK_TRANSACTIONS
  .filter(t => t.date.startsWith(currentMonthPrefix))
  .sort((a, b) => b.date.localeCompare(a.date))

/** personal 账套本月收入（供默认值展示） */
export const MOCK_INCOME = MOCK_THIS_MONTH
  .filter(t => t.ledgerId === 'personal' && t.amount > 0)
  .reduce((sum, t) => sum + t.amount, 0)

/** personal 账套本月支出 */
export const MOCK_EXPENSE = MOCK_THIS_MONTH
  .filter(t => t.ledgerId === 'personal' && t.amount < 0 && t.category !== '转账')
  .reduce((sum, t) => sum + Math.abs(t.amount), 0)
