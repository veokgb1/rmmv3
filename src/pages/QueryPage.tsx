// QueryPage — 账单查询页 (S19 全功能版)
//
// 功能：
//   ① 关键词搜索（描述 / 分类）
//   ② 收支方向快捷筛选（全部 / 收入 / 支出）
//   ③ 一级分类筛选（横向滚动 Chip）
//   ④ 月份快捷筛选（本月 / 上月 / 不限）
//   ⑤ 账单结果列表（按日期降序，空态友好提示）
//   ⑥ 顶部汇总条：筛选结果的条数 / 收入 / 支出

import { useState, useCallback } from 'react'
import {
  useQueryBills,
  DEFAULT_FILTERS,
  type QueryFilters,
  type DirectionFilter,
} from '@/hooks/useQueryBills'
import { formatAmount }  from '@/utils/numberUtils'
import { toChineseDate } from '@/utils/dateUtils'
import type { Transaction } from '@/types/Transaction.types'
import { TimeFilter, DEFAULT_TIME_FILTER, type TimeFilterValue } from '@/components/ui/TimeFilter'

// ── 常量 ───────────────────────────────────────────────────────

const CATEGORY_ICON: Record<string, string> = {
  '餐饮': '🍜', '交通': '🚇', '购物': '🛍️', '娱乐': '🎮',
  '医疗': '💊', '居住': '🏠', '教育': '📚', '工资': '💰',
  '副业收入': '💻', '理财收益': '📈', '转账': '↔️', '未分类': '📋',
}

const CATEGORIES = Object.keys(CATEGORY_ICON)

/** 生成 YYYY-MM 格式的月份前缀（offset=0 本月，offset=-1 上月…） */
function monthPrefix(offset = 0): string {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── 主组件 ─────────────────────────────────────────────────────

function QueryPage() {
  const [filters,    setFilters]    = useState<QueryFilters>(DEFAULT_FILTERS)
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>(DEFAULT_TIME_FILTER)

  const { bills, totalCount, income, expense, billsReady } = useQueryBills(filters)

  const setKeyword   = useCallback((kw: string) =>
    setFilters(f => ({ ...f, keyword: kw })), [])

  const setDirection = useCallback((d: DirectionFilter) =>
    setFilters(f => ({ ...f, direction: d })), [])

  const setCategory  = useCallback((cat: string | null) =>
    setFilters(f => ({ ...f, category: cat })), [])

  const handleTimeChange = useCallback((tv: TimeFilterValue) => {
    setTimeFilter(tv)
    setFilters(f => ({ ...f, dateFrom: tv.dateFrom, dateTo: tv.dateTo }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setTimeFilter(DEFAULT_TIME_FILTER)
  }, [])

  // 是否有任何筛选条件激活（用于显示「清空」按钮）
  const hasActiveFilters =
    filters.keyword !== '' ||
    filters.direction !== 'all' ||
    filters.category !== null ||
    filters.dateFrom !== null

  return (
    <div className="flex flex-col min-h-full bg-gray-50">

      {/* ── 顶部搜索区（sticky） ──────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(0,0,0,0.06)] px-4 pt-4 pb-3 space-y-3">

        {/* 标题行 */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">账单查询</h1>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              清空筛选
            </button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
            🔍
          </span>
          <input
            type="text"
            value={filters.keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索商家名称、分类..."
            className="w-full pl-9 pr-9 py-2.5 bg-gray-50 border border-gray-200 rounded-xl
                       text-sm text-gray-700 placeholder-gray-400
                       focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
          {filters.keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </div>

        {/* 收支方向 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {(
            [
              { value: 'all',     label: '全部' },
              { value: 'expense', label: '支出' },
              { value: 'income',  label: '收入' },
            ] as { value: DirectionFilter; label: string }[]
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setDirection(value)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filters.direction === value
                  ? 'bg-content-primary text-content-inverse'
                  : 'bg-surface-overlay text-content-secondary hover:bg-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 时间筛选器 */}
        <TimeFilter value={timeFilter} onChange={handleTimeChange} />

        {/* 分类 Chips（横向滚动） */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          {/* 全部分类 */}
          <button
            onClick={() => setCategory(null)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filters.category === null
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            全部分类
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(filters.category === cat ? null : cat)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filters.category === cat
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {CATEGORY_ICON[cat]} {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── 结果汇总条 ───────────────────────────────────────── */}
      {billsReady && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50
                        border-b border-gray-100 text-xs text-gray-500">
          <span>
            共 <span className="font-semibold text-gray-700">{totalCount}</span> 条
          </span>
          <div className="flex gap-4">
            <span>
              收入 <span className="font-semibold text-emerald-600">+¥{formatAmount(income)}</span>
            </span>
            <span>
              支出 <span className="font-semibold text-rose-500">-¥{formatAmount(expense)}</span>
            </span>
          </div>
        </div>
      )}

      {/* ── 账单列表 ─────────────────────────────────────────── */}
      <div className="flex-1 px-4 py-3 space-y-1">

        {/* 加载中骨架 */}
        {!billsReady && (
          <div className="space-y-2 mt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-white rounded-xl animate-pulse border border-gray-100" />
            ))}
          </div>
        )}

        {/* 空态提示 */}
        {billsReady && bills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm font-medium text-gray-500">
              {hasActiveFilters ? '没有符合条件的账单' : '暂无账单记录'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {hasActiveFilters ? '尝试修改搜索条件或清空筛选' : '从首页导入或录入账单后将在此显示'}
            </p>
          </div>
        )}

        {/* 账单卡片列表 */}
        {billsReady && bills.length > 0 && (
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
            {bills.map((tx, i) => (
              <BillRow key={tx.id} tx={tx} isLast={i === bills.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 子组件：单行账单 ─────────────────────────────────────────

interface BillRowProps {
  tx:     Transaction
  isLast: boolean
}

function BillRow({ tx, isLast }: BillRowProps) {
  const icon      = CATEGORY_ICON[tx.category] ?? '📋'
  const isIncome  = tx.amount > 0
  const absAmount = Math.abs(tx.amount)

  const rawLegacy   = tx.rawData?.['legacy_backup'] as Record<string, unknown> | undefined
  const legacySummary = rawLegacy?.['summary'] as string | undefined
  const displayDesc =
    legacySummary ||
    (tx.description !== tx.category ? tx.description : '') ||
    tx.description ||
    '无摘要'

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 ${!isLast ? 'border-b border-border-light' : ''}`}>
      <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center text-sm flex-shrink-0 overflow-hidden leading-none">
        {icon}
      </div>

      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-[13px] font-bold text-slate-800 truncate leading-snug">{displayDesc}</p>
        {tx.remark ? (
          <p className="text-[10px] text-content-secondary truncate mt-px leading-snug italic">💬 {tx.remark}</p>
        ) : null}
        <p className="text-[10px] text-content-tertiary mt-0.5 truncate">
          {tx.category}
          <span className="mx-1 opacity-40">·</span>
          {toChineseDate(tx.date)}
          {tx.isDuplicate && <span className="ml-1 text-amber-500">疑似重复</span>}
        </p>
      </div>

      <span className={`ml-auto flex-shrink-0 text-sm font-bold tabular-nums ${
        isIncome ? 'text-income' : 'text-expense'
      }`}>
        {isIncome ? '+' : '\u2212'}¥{formatAmount(absAmount)}
      </span>
    </div>
  )
}

export default QueryPage
