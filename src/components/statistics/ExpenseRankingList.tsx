// 分类支出排行榜 — S6 统计看板
// 水平进度条列表，前 N 名支出分类降序展示
// 分类来源：Transaction.category（SystemCategory，架构对齐）
// 颜色盘与 CategoryPieChart 保持一致，共用同一语义色彩体系

import { useMemo } from 'react'
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 分类颜色盘（与 CategoryPieChart 语义一致）
// 注：此色盘对应 SystemCategory 枚举，不可随意扩展
// ─────────────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  '餐饮':     '#f97316',
  '交通':     '#3b82f6',
  '购物':     '#a855f7',
  '娱乐':     '#ec4899',
  '医疗':     '#ef4444',
  '居住':     '#eab308',
  '教育':     '#06b6d4',
  '工资':     '#22c55e',
  '副业收入': '#14b8a6',
  '理财收益': '#6366f1',
  '转账':     '#94a3b8',
  '未分类':   '#cbd5e1',
}
const FALLBACK_COLORS = [
  '#f59e0b','#84cc16','#0ea5e9','#d946ef',
  '#fb923c','#4ade80','#38bdf8','#e879f9',
]

// 奖牌样式（前三名视觉高亮）
const RANK_STYLE: Record<number, { label: string; bg: string; text: string }> = {
  1: { label: '🥇', bg: 'bg-amber-50',   text: 'text-amber-600'  },
  2: { label: '🥈', bg: 'bg-slate-50',   text: 'text-slate-500'  },
  3: { label: '🥉', bg: 'bg-orange-50',  text: 'text-orange-600' },
}

// ─────────────────────────────────────────────────────────────
// 数据处理
// ─────────────────────────────────────────────────────────────
interface RankItem {
  rank:    number
  name:    string
  amount:  number
  color:   string
  pct:     number   // 相对于第一名的百分比（进度条宽度）
  sharePct: number  // 占总支出的百分比（显示用）
}

function buildRankingData(bills: Transaction[], topN: number): RankItem[] {
  // 仅统计支出，排除转账（与 useBills 的 expense 计算逻辑一致）
  const expenses = bills.filter(t => t.amount < 0 && t.category !== '转账')
  if (expenses.length === 0) return []

  const map: Record<string, number> = {}
  for (const t of expenses) {
    map[t.category] = (map[t.category] ?? 0) + Math.abs(t.amount)
  }

  const sorted = Object.entries(map)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, topN)

  const total   = expenses.reduce((s, t) => s + Math.abs(t.amount), 0)
  const maxAmt  = sorted[0]?.amount ?? 1

  return sorted.map(({ name, amount }, i) => ({
    rank:     i + 1,
    name,
    amount,
    color:    CATEGORY_COLOR[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    pct:      Math.round((amount / maxAmt) * 100),
    sharePct: Math.round((amount / total) * 100),
  }))
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
interface ExpenseRankingListProps {
  bills:    Transaction[]   // thisMonthBills（已按账套+本月双过滤）
  topN?:    number          // 展示前 N 名，默认 5
  currency?: string
}

export default function ExpenseRankingList({
  bills,
  topN = 5,
  currency = 'CNY',
}: ExpenseRankingListProps) {
  const data = useMemo(() => buildRankingData(bills, topN), [bills, topN])

  const sym = currency === 'CAD' ? 'CA$' :
              currency === 'USD' ? 'US$' :
              currency === 'HKD' ? 'HK$' : '¥'

  if (data.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-2xl mb-1.5">🏆</p>
        <p className="text-xs text-content-tertiary">本月暂无支出记录</p>
      </div>
    )
  }

  return (
    <div className="space-y-3.5">
      {data.map((item) => {
        const medal = RANK_STYLE[item.rank]
        return (
          <div key={item.name}>
            {/* 名称行 */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                {/* 排名徽章 */}
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center
                                flex-shrink-0 text-xs font-bold
                                ${medal ? medal.bg : 'bg-surface-overlay'}
                                ${medal ? medal.text : 'text-content-tertiary'}`}>
                  {medal ? medal.label : item.rank}
                </div>

                {/* 颜色点 + 分类名 */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: item.color }}
                  />
                  <span className="text-xs font-medium text-content-primary truncate">
                    {item.name}
                  </span>
                </div>
              </div>

              {/* 金额 + 占比 */}
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span className="text-[11px] text-content-tertiary tabular-nums">
                  {item.sharePct}%
                </span>
                <span className="text-xs font-semibold text-content-primary tabular-nums">
                  {sym}{item.amount.toLocaleString('zh-CN', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>
            </div>

            {/* 进度条（相对于第一名，视觉对比更直观） */}
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width:      `${item.pct}%`,
                  background: item.color,
                  opacity:    item.rank === 1 ? 1 : 0.65 + (5 - item.rank) * 0.08,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
