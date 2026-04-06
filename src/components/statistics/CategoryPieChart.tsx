// 消费分类占比图 — S6 数据可视化
// 环形图（Donut）展示当前账套本月各支出分类占比
// 订阅 thisMonthBills，账套切换时自动重绘

import { useMemo } from 'react'
import {
  PieChart, Pie, Cell,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 颜色盘（现代和谐色系，对应常用分类）
// ─────────────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  '餐饮':     '#f97316',  // orange-500
  '交通':     '#3b82f6',  // blue-500
  '购物':     '#a855f7',  // purple-500
  '娱乐':     '#ec4899',  // pink-500
  '医疗':     '#ef4444',  // red-500
  '居住':     '#eab308',  // yellow-500
  '教育':     '#06b6d4',  // cyan-500
  '工资':     '#22c55e',  // green-500
  '副业收入': '#14b8a6',  // teal-500
  '理财收益': '#6366f1',  // indigo-500
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

// ─────────────────────────────────────────────────────────────
// 数据处理
// ─────────────────────────────────────────────────────────────
interface CategorySlice {
  name:    string
  value:   number   // 绝对金额（支出）
  color:   string
  percent: number   // 0-100
}

function buildCategoryData(bills: Transaction[]): CategorySlice[] {
  // 只统计支出，排除转账
  const expenseBills = bills.filter(t => t.amount < 0 && t.category !== '转账')
  const total = expenseBills.reduce((s, t) => s + Math.abs(t.amount), 0)
  if (total === 0) return []

  // 按分类汇总
  const map: Record<string, number> = {}
  for (const t of expenseBills) {
    map[t.category] = (map[t.category] ?? 0) + Math.abs(t.amount)
  }

  // 转为数组并按金额降序排列
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], index) => ({
      name,
      value: Math.round(value * 100) / 100,
      color: getCategoryColor(name, index),
      percent: Math.round((value / total) * 100),
    }))
}

// ─────────────────────────────────────────────────────────────
// 自定义 Tooltip
// ─────────────────────────────────────────────────────────────
interface TooltipPayloadItem {
  name:    string
  value:   number
  payload: CategorySlice
}
interface CustomTooltipProps {
  active?:  boolean
  payload?: TooltipPayloadItem[]
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: d.payload.color }}
        />
        <span className="font-semibold text-content-primary">{d.name}</span>
      </div>
      <p className="text-content-secondary tabular-nums">
        ¥{d.value.toLocaleString()}
        <span className="ml-1.5 text-content-tertiary">({d.payload.percent}%)</span>
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 自定义图例
// ─────────────────────────────────────────────────────────────
interface LegendProps {
  payload?: { value: string; color: string }[]
}

function CustomLegend({ payload }: LegendProps) {
  if (!payload?.length) return null
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 mt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-[11px] text-content-secondary">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
interface CategoryPieChartProps {
  bills:             Transaction[]                          // 调用方传入 thisMonthBills（已按账套隔离）
  /** 点击扇区回调：传 null = 取消筛选，传分类名 = 激活该分类筛选 */
  onCategoryClick?:  (category: string | null) => void
  /** 当前激活的筛选分类（null = 全部显示） */
  selectedCategory?: string | null
}

export default function CategoryPieChart({
  bills,
  onCategoryClick,
  selectedCategory,
}: CategoryPieChartProps) {
  const data = useMemo(() => buildCategoryData(bills), [bills])

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <p className="text-2xl mb-2">🥧</p>
        <p className="text-xs text-content-tertiary">本月暂无支出数据</p>
      </div>
    )
  }

  // 点击扇区：再次点击同一分类则取消筛选（toggle 逻辑）
  function handlePieClick(entry: CategorySlice) {
    if (!onCategoryClick) return
    onCategoryClick(selectedCategory === entry.name ? null : entry.name)
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            animationBegin={0}
            animationDuration={600}
            onClick={(entry: any) => handlePieClick(entry)}
            style={onCategoryClick ? { cursor: 'pointer' } : undefined}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                // 有选中分类时：未选中的扇区半透明，选中扇区保持实色
                opacity={selectedCategory && selectedCategory !== entry.name ? 0.3 : 1}
                stroke={selectedCategory === entry.name ? '#fff' : 'none'}
                strokeWidth={selectedCategory === entry.name ? 2 : 0}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>

      {/* 筛选激活提示条 */}
      {selectedCategory && onCategoryClick && (
        <div className="flex items-center justify-between px-1 mt-1">
          <p className="text-[11px] text-primary-600 font-medium">
            已筛选：{selectedCategory}
          </p>
          <button
            onClick={() => onCategoryClick(null)}
            className="text-[11px] text-content-tertiary hover:text-content-secondary
                       underline underline-offset-2 transition-colors"
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  )
}
