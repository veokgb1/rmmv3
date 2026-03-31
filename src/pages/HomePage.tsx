// 首页：时钟/天气横幅 + 本月收支概览 + 最近账单列表
// S2 阶段：使用 Mock 数据驱动，UI 完全可用，S3 替换数据源时此文件无需改动

import { useMemo } from 'react'

// 引入 Mock 数据（S3 后替换为真实 Hook：useBills）
import {
  MOCK_THIS_MONTH,
  MOCK_INCOME,
  MOCK_EXPENSE,
} from '@/mock/transactions.mock'

// 引入工具函数
import { formatAmount }  from '@/utils/numberUtils'
import { toChineseDate } from '@/utils/dateUtils'

// 引入两个 Widget 组件
import ClockWidget   from '@/widgets/ClockWidget'
import WeatherWidget from '@/widgets/WeatherWidget'

// 引入类型
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 子组件：收支概览卡片
// ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label:  string   // 标签文字：如"本月收入"
  amount: number   // 金额（已是绝对值）
  type:   'income' | 'expense' | 'net'  // 决定颜色风格
}

function SummaryCard({ label, amount, type }: SummaryCardProps) {
  // 根据类型决定金额的文字颜色样式
  // Tailwind 嵌套色 DEFAULT 键对应的类名不含 -DEFAULT 后缀，直接用 text-income
  const amountColor =
    type === 'income'  ? 'text-income' :
    type === 'expense' ? 'text-expense' :
    amount >= 0        ? 'text-income' : 'text-expense'

  // 净收支前缀符号：正数显示+，负数显示-
  const prefix =
    type === 'net'    ? (amount >= 0 ? '+' : '-') :
    type === 'income' ? '+' : '-'

  return (
    // 卡片容器：flex 列方向，居中展示
    <div className="card flex-1 flex flex-col items-center py-4 gap-1">
      {/* 标签文字：次要灰色 */}
      <span className="text-xs text-content-tertiary">{label}</span>
      {/* 金额：大号加粗，根据类型显示对应颜色 */}
      <span className={`text-lg font-bold ${amountColor}`}>
        {/* 前缀符号 */}
        <span className="text-sm font-medium mr-0.5">{prefix}¥</span>
        {formatAmount(Math.abs(amount))}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 子组件：分类图标映射
// 根据账单分类返回对应的 emoji 图标和背景色
// ─────────────────────────────────────────────────────────────

// 分类 → { 图标, 背景色 } 的映射表
const CATEGORY_ICON: Record<string, { icon: string; bg: string }> = {
  '餐饮':   { icon: '🍜', bg: 'bg-orange-50' },
  '交通':   { icon: '🚇', bg: 'bg-blue-50'   },
  '购物':   { icon: '🛍️', bg: 'bg-purple-50' },
  '娱乐':   { icon: '🎮', bg: 'bg-pink-50'   },
  '医疗':   { icon: '💊', bg: 'bg-red-50'    },
  '居住':   { icon: '🏠', bg: 'bg-yellow-50' },
  '教育':   { icon: '📚', bg: 'bg-cyan-50'   },
  '工资':   { icon: '💰', bg: 'bg-green-50'  },
  '副业收入': { icon: '💻', bg: 'bg-teal-50' },
  '理财收益': { icon: '📈', bg: 'bg-emerald-50' },
  '转账':   { icon: '↔️', bg: 'bg-gray-50'   },
  '未分类': { icon: '📋', bg: 'bg-slate-50'  },
}

// 获取分类图标信息，未找到则返回默认值
function getCategoryMeta(category: string) {
  return CATEGORY_ICON[category] ?? { icon: '📋', bg: 'bg-gray-50' }
}

// ─────────────────────────────────────────────────────────────
// 子组件：单条账单列表项
// ─────────────────────────────────────────────────────────────

interface BillItemProps {
  transaction: Transaction
}

function BillItem({ transaction }: BillItemProps) {
  const { icon, bg } = getCategoryMeta(transaction.category)  // 获取分类图标信息
  const isIncome = transaction.amount > 0                      // 判断是收入还是支出

  return (
    // 列表项容器：横向排列，点击 hover 效果
    <div className="flex items-center gap-3 py-3 px-1">

      {/* 左侧：分类图标圆形背景 */}
      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0 text-lg`}>
        {icon}
      </div>

      {/* 中间：描述文字 + 分类标签 + 日期 */}
      <div className="flex-1 min-w-0">
        {/* 描述文字：超长截断显示省略号 */}
        <p className="text-sm font-medium text-content-primary truncate">
          {transaction.description}
        </p>
        {/* 分类 + 日期：小字，次要颜色 */}
        <p className="text-xs text-content-tertiary mt-0.5">
          <span>{transaction.category}</span>
          <span className="mx-1.5 opacity-40">·</span>
          {/* 日期转中文格式：2026-03-15 → 3月15日 */}
          <span>{toChineseDate(transaction.date)}</span>
        </p>
      </div>

      {/* 右侧：金额（收入绿，支出深灰） */}
      <div className="flex-shrink-0 text-right">
        <span className={`text-sm font-semibold tabular-nums ${
          isIncome ? 'text-income' : 'text-content-primary'
        }`}>
          {/* 收入显示绿色加号，支出显示负号 */}
          {isIncome ? '+' : '-'}¥{formatAmount(Math.abs(transaction.amount))}
        </span>
        {/* 数据来源标记：小字提示 */}
        <p className="text-[10px] text-content-tertiary mt-0.5">
          {transaction.source === 'wechat'  ? '微信'   :
           transaction.source === 'alipay'  ? '支付宝' :
           transaction.source === 'manual'  ? '手动'   : '银行'}
        </p>
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件：HomePage
// ─────────────────────────────────────────────────────────────

function HomePage() {
  // 计算净收支（收入 - 支出）
  const netAmount = useMemo(() => MOCK_INCOME - MOCK_EXPENSE, [])

  // 取最近 8 条账单显示在首页列表（避免列表过长）
  const recentBills = useMemo(() => MOCK_THIS_MONTH.slice(0, 8), [])

  return (
    // 页面容器：使用全局 .page-container 保证底部安全距离
    <div className="page-container">

      {/* ══ 顶部标题栏 ════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-4 pt-1">
        {/* 左侧：应用名 + 副标题 */}
        <div>
          <h1 className="text-xl font-bold text-content-primary">资金总览</h1>
          <p className="text-xs text-content-tertiary mt-0.5">个人资金管理系统</p>
        </div>
        {/* 右侧：头像占位（S2 接入用户系统后替换） */}
        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-sm">
          👤
        </div>
      </div>

      {/* ══ 主横幅卡片：时钟 + 天气 + 收支概览 ════════════════ */}
      {/* 一张深色渐变大卡，从上到下分三个区域 */}
      <div className="rounded-2xl p-5 mb-4 bg-gradient-to-br from-primary-700 to-primary-500 text-white shadow-fab">

        {/* ── 区域①：时钟 + 天气（水平分栏） ──────────────── */}
        <div className="flex flex-col gap-3 mb-5">
          {/* 时钟组件：左年月日/右时分秒 */}
          <ClockWidget />
          {/* 水平细分割线，透明白色，将时钟和天气视觉分隔 */}
          <div className="h-px bg-white/10" />
          {/* 天气组件：左城市+状况，右温度（S2使用Mock数据） */}
          <WeatherWidget />
        </div>

        {/* ── 区域②：净收支主数字 ───────────────────────────── */}
        {/* 分割线：将 Widget 区与财务区隔开 */}
        <div className="h-px bg-white/15 mb-4" />

        <p className="text-xs text-white/60 mb-1">本月净收支</p>
        <p className="text-3xl font-bold tracking-tight mb-4">
          {/* 前缀符号：正数显示+，负数显示− */}
          <span className="text-xl mr-1">{netAmount >= 0 ? '+' : '−'}¥</span>
          {formatAmount(Math.abs(netAmount))}
        </p>

        {/* ── 区域③：收入 / 支出 两列对比 ─────────────────── */}
        <div className="flex gap-4">
          {/* 收入列 */}
          <div className="flex-1">
            <p className="text-xs text-white/60 mb-0.5">收入</p>
            <p className="text-base font-semibold text-white/95">
              ¥{formatAmount(MOCK_INCOME)}
            </p>
          </div>
          {/* 垂直细分割线 */}
          <div className="w-px bg-white/20" />
          {/* 支出列 */}
          <div className="flex-1">
            <p className="text-xs text-white/60 mb-0.5">支出</p>
            <p className="text-base font-semibold text-white/95">
              ¥{formatAmount(MOCK_EXPENSE)}
            </p>
          </div>
        </div>
      </div>

      {/* ══ 快捷操作入口 ═════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 mb-4">

        {/* 导入账单 */}
        <button className="card card-hover flex flex-col items-center py-4 gap-2 no-select">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-xl">
            📥
          </div>
          <span className="text-sm font-medium text-content-primary">导入账单</span>
          <span className="text-xs text-content-tertiary">微信 / 支付宝</span>
        </button>

        {/* 手动记账 */}
        <button className="card card-hover flex flex-col items-center py-4 gap-2 no-select">
          <div className="w-10 h-10 rounded-xl bg-income-bg flex items-center justify-center text-xl">
            ✏️
          </div>
          <span className="text-sm font-medium text-content-primary">手动记账</span>
          <span className="text-xs text-content-tertiary">快速录入一笔</span>
        </button>
      </div>

      {/* ══ 最近账单列表 ═════════════════════════════════════ */}
      <div className="card">

        {/* 列表标题行 */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-content-primary">最近账单</h2>
          {/* "查看全部"链接（S4 完成后跳转到 QueryPage） */}
          <button className="text-xs text-primary-600 font-medium">
            查看全部 ›
          </button>
        </div>

        {/* 账单数量提示 */}
        <p className="text-xs text-content-tertiary mb-3">
          本月共 {MOCK_THIS_MONTH.length} 笔记录
        </p>

        {/* 账单列表：每条之间有分割线，最后一条不显示 */}
        <div>
          {recentBills.length > 0 ? (
            recentBills.map((transaction, index) => (
              <div key={transaction.id}>
                {/* 渲染单条账单 */}
                <BillItem transaction={transaction} />
                {/* 分割线：最后一条不渲染 */}
                {index < recentBills.length - 1 && (
                  <div className="divider ml-14" /> // ml-14 对齐图标右侧
                )}
              </div>
            ))
          ) : (
            // 空状态：无账单数据时的占位提示
            <div className="py-10 text-center">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm text-content-tertiary">暂无账单数据</p>
              <p className="text-xs text-content-tertiary mt-1 opacity-70">
                导入账单或手动记账后显示
              </p>
            </div>
          )}
        </div>

        {/* 超出 8 条时，显示"更多"提示 */}
        {MOCK_THIS_MONTH.length > 8 && (
          <button className="w-full mt-3 py-2.5 text-xs text-content-tertiary
                             bg-surface-overlay rounded-lg text-center hover:bg-gray-100
                             transition-colors">
            还有 {MOCK_THIS_MONTH.length - 8} 条记录，点击查看全部 ›
          </button>
        )}
      </div>

    </div>
  )
}

// 导出首页组件
export default HomePage
