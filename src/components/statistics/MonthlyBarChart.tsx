// 月度收支趋势图 — S6 数据可视化
// 订阅 useBills().allLedgerBills，账套切换时自动重绘动画
// 展示最近 6 个月的收入（emerald）与支出（rose）对比柱状图

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 数据处理：将全量账单按月归并为图表数据点
// ─────────────────────────────────────────────────────────────

interface MonthPoint {
  month:   string   // 显示标签，如 "3月" "4月"
  monthKey: string  // YYYY-MM，用于排序
  income:  number
  expense: number
}

/** 生成最近 N 个月的月份键列表（YYYY-MM） */
function getRecentMonthKeys(n: number): string[] {
  const keys: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    )
  }
  return keys
}

function buildMonthlyData(bills: Transaction[], months = 6): MonthPoint[] {
  const monthKeys = getRecentMonthKeys(months)

  // 初始化全 0
  const map: Record<string, MonthPoint> = {}
  for (const key of monthKeys) {
    const [, m] = key.split('-')
    map[key] = { month: `${Number(m)}月`, monthKey: key, income: 0, expense: 0 }
  }

  // 累加真实数据
  for (const t of bills) {
    const key = t.date.slice(0, 7)  // YYYY-MM
    if (!map[key]) continue         // 超出 N 个月范围，忽略
    if (t.amount > 0) {
      map[key].income += t.amount
    } else if (t.category !== '转账') {
      map[key].expense += Math.abs(t.amount)
    }
  }

  return monthKeys.map(k => ({
    ...map[k],
    income:  Math.round(map[k].income),
    expense: Math.round(map[k].expense),
  }))
}

// ─────────────────────────────────────────────────────────────
// 自定义 Tooltip（移动端友好，数字两端对齐）
// ─────────────────────────────────────────────────────────────
interface TooltipPayloadItem {
  name:  string
  value: number
  color: string
}
interface CustomTooltipProps {
  active?:  boolean
  payload?: TooltipPayloadItem[]
  label?:   string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-content-primary mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium tabular-nums">¥{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
interface MonthlyBarChartProps {
  bills: Transaction[]  // 调用方传入 allLedgerBills（已按账套隔离）
}

export default function MonthlyBarChart({ bills }: MonthlyBarChartProps) {
  const data = useMemo(() => buildMonthlyData(bills, 6), [bills])

  // 判断是否有任何真实数据
  const hasData = data.some(d => d.income > 0 || d.expense > 0)

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <p className="text-2xl mb-2">📊</p>
        <p className="text-xs text-content-tertiary">暂无收支数据</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
          barGap={2}
          barCategoryGap="30%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#f1f5f9"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
            }
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
          <Legend
            formatter={(value) => (
              <span className="text-xs text-content-secondary">{value}</span>
            )}
            wrapperStyle={{ paddingTop: 8 }}
          />
          <Bar
            dataKey="income"
            name="收入"
            fill="#10b981"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="expense"
            name="支出"
            fill="#f43f5e"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
