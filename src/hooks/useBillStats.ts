// useBillStats — 首页智慧看板数据 Hook
// 基于 useBills() + useLedger() 计算月度财务洞察
// 提供：本月总支出 / 日均支出 / 分类占比 / 预算剩余 / 本月预计总支出

import { useMemo } from 'react'
import { useBills }  from '@/hooks/useBills'
import { useLedger } from '@/hooks/useLedger'
import type { LedgerType } from '@/types/Ledger.types'

// ── Mock 月度预算（与 BudgetProgressBar 保持一致，S9 阶段接入 Firestore） ────
const MOCK_BUDGETS: Record<LedgerType, number> = {
  personal:   8000,   // 个人月度预算 ¥8,000
  family:     5000,   // 家庭月度预算 ¥5,000
  enterprise: 3000,   // 企业差旅/运营月度预算
}

// ── 分类颜色映射（与 CategoryPieChart 保持一致） ──────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  '餐饮':     '#f97316',  // orange-500
  '交通':     '#3b82f6',  // blue-500
  '购物':     '#a855f7',  // purple-500
  '娱乐':     '#ec4899',  // pink-500
  '医疗':     '#ef4444',  // red-500
  '居住':     '#eab308',  // yellow-500
  '教育':     '#06b6d4',  // cyan-500
  '转账':     '#94a3b8',  // slate-400
  '未分类':   '#cbd5e1',  // slate-300
}
const FALLBACK_COLORS = [
  '#f59e0b', '#84cc16', '#0ea5e9', '#d946ef',
  '#fb923c', '#4ade80', '#38bdf8', '#e879f9',
]
function getCategoryColor(name: string, index: number): string {
  return CATEGORY_COLOR[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

// ── 分类数据切片结构 ──────────────────────────────────────────────────────
export interface CategorySlice {
  name:    string   // 分类名
  value:   number   // 支出金额（绝对值）
  color:   string   // 图表颜色
  percent: number   // 占总支出的百分比（0-100）
}

// ── Hook 返回值接口 ──────────────────────────────────────────────────────
export interface BillStats {
  /** 本月总支出（绝对值，排除转账分类） */
  totalExpense:     number
  /** 日均支出 = 本月总支出 / 当月已过天数 */
  dailyAvg:         number
  /** Mock 月度预算额度（S9 阶段替换为 Firestore budgets 集合） */
  budget:           number
  /** 预算剩余（超支时为 0，由 overrun 字段判断是否超支） */
  budgetRemaining:  number
  /** 是否已超支 */
  overrun:          boolean
  /** 超支金额（expense - budget，仅 overrun=true 时有意义） */
  overrunAmount:    number
  /** 按日均线性外推的本月预计总支出 = 日均 × 当月总天数 */
  projectedExpense: number
  /** 当月已过天数（≥1，防首日除零） */
  daysElapsed:      number
  /** 当月总天数 */
  daysInMonth:      number
  /** 各分类支出占比（按金额降序，排除转账） */
  categorySlices:   CategorySlice[]
  /** 透传 useBills 的加载状态 */
  billsReady:       boolean
}

// ─────────────────────────────────────────────────────────────────────────
// useBillStats — 主 Hook
// ─────────────────────────────────────────────────────────────────────────
export function useBillStats(): BillStats {
  // 从 useBills 拿到本月支出总额和本月账单列表
  const { expense, thisMonthBills, billsReady } = useBills()
  // 从 useLedger 拿到当前账套（用于查 Mock 预算）
  const { activeLedger } = useLedger()

  // ── 时间维度 ──────────────────────────────────────────────────────────
  const today = new Date()
  // 当月已过天数：至少为 1，防止首日除零
  const daysElapsed = Math.max(today.getDate(), 1)
  // 当月总天数：下月 0 日 = 当月最后一天
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  // ── 支出洞察 ──────────────────────────────────────────────────────────
  // 日均支出（保持两位小数精度）
  const dailyAvg         = expense / daysElapsed
  // 本月预计总支出（线性外推，不考虑周末/假期波动）
  const projectedExpense = dailyAvg * daysInMonth

  // ── 预算计算 ──────────────────────────────────────────────────────────
  const ledgerType      = activeLedger?.type ?? 'personal'
  const budget          = MOCK_BUDGETS[ledgerType] ?? MOCK_BUDGETS.personal
  const overrun         = expense > budget
  const overrunAmount   = overrun ? expense - budget : 0
  const budgetRemaining = overrun ? 0 : budget - expense

  // ── 分类占比（useMemo 缓存，账单列表变化时才重算） ────────────────────
  const categorySlices = useMemo<CategorySlice[]>(() => {
    // 仅统计支出，排除转账（转账不计入消费分析）
    const expenseBills = thisMonthBills.filter(t => t.amount < 0 && t.category !== '转账')
    const total = expenseBills.reduce((sum, t) => sum + Math.abs(t.amount), 0)
    if (total === 0) return []

    // 按分类汇总绝对金额
    const map: Record<string, number> = {}
    for (const t of expenseBills) {
      map[t.category] = (map[t.category] ?? 0) + Math.abs(t.amount)
    }

    // 转为数组：按金额降序，附颜色 + 占比
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value], index) => ({
        name,
        value:   Math.round(value * 100) / 100,
        color:   getCategoryColor(name, index),
        percent: Math.round((value / total) * 100),
      }))
  }, [thisMonthBills])

  return {
    totalExpense:    expense,
    dailyAvg,
    budget,
    budgetRemaining,
    overrun,
    overrunAmount,
    projectedExpense,
    daysElapsed,
    daysInMonth,
    categorySlices,
    billsReady,
  }
}
