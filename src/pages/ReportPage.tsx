// ReportPage — 财务报表页 (S19 全功能版)
//
// 功能：
//   ① 月份切换器（最近 6 个月，默认本月）
//   ② StatCards：所选月收入 / 支出 / 净结余
//   ③ MonthlyBarChart：全账套近 6 个月趋势（不受月份切换影响，展示完整趋势）
//   ④ CategoryPieChart：所选月支出分类占比
//   ⑤ ExpenseRankingList：所选月支出分类排行

import { useState, useMemo } from 'react'
import { useLedgerStore }    from '@/store/ledgerStore'
import { useBillStore }      from '@/store/billStore'

import StatCards          from '@/components/statistics/StatCards'
import MonthlyBarChart    from '@/components/statistics/MonthlyBarChart'
import CategoryPieChart   from '@/components/statistics/CategoryPieChart'
import ExpenseRankingList from '@/components/statistics/ExpenseRankingList'
import {
  TimeFilter,
  makeTimeFilterValue,
  type TimeFilterValue,
} from '@/components/ui/TimeFilter'

// ── 主组件 ─────────────────────────────────────────────────────

function ReportPage() {
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>(
    makeTimeFilterValue('this')
  )

  const activeLedger   = useLedgerStore(s => s.ledgers.find(l => l.id === s.activeLedgerId))
  const currency       = activeLedger?.currency ?? 'CNY'
  const allLedgerBills = useBillStore(s => s._allTransactions)
  const billsReady     = useBillStore(s => s.billsReady)

  const selectedMonthBills = useMemo(() => {
    const { dateFrom, dateTo } = timeFilter
    return allLedgerBills.filter(tx => {
      if (tx.status === 'void') return false
      if (!dateFrom) return true
      return tx.date >= dateFrom && tx.date <= (dateTo ?? '9999-99-99')
    })
  }, [allLedgerBills, timeFilter])

  const { income, expense, net } = useMemo(() => {
    let inc = 0, exp = 0
    selectedMonthBills.forEach(tx => {
      if (tx.amount > 0) inc += tx.amount
      else               exp -= tx.amount
    })
    return { income: inc, expense: exp, net: inc - exp }
  }, [selectedMonthBills])

  return (
    <div className="p-4 space-y-4 pb-6">

      <div className="pt-2">
        <h1 className="text-xl font-bold text-content-primary">财务报表</h1>
        <p className="text-xs text-content-tertiary mt-1">可视化收支结构与趋势</p>
      </div>

      <TimeFilter value={timeFilter} onChange={setTimeFilter} />

      {/* ── 骨架屏（数据未就绪） ──────────────────────────────── */}
      {!billsReady && (
        <div className="space-y-3">
          <div className="flex gap-2.5">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex-1 h-20 bg-gray-100 rounded-2xl animate-pulse" />
            ))}
          </div>
          <div className="h-52 bg-gray-100 rounded-2xl animate-pulse" />
          <div className="h-52 bg-gray-100 rounded-2xl animate-pulse" />
          <div className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
      )}

      {/* ── 数据就绪后的真实内容 ──────────────────────────────── */}
      {billsReady && (
        <>
          {/* ① KPI 卡：收入 / 支出 / 净结余 */}
          <StatCards
            income={income}
            expense={expense}
            net={net}
            currency={currency}
          />

          {/* ② 月度趋势柱状图（展示全量账套账单，体现完整趋势） */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-sm font-semibold text-gray-800 mb-0.5">月度收支趋势</p>
            <p className="text-xs text-gray-400 mb-4">近 6 个月收入与支出对比</p>
            <MonthlyBarChart bills={allLedgerBills} />
          </div>

          {/* ③ 本月支出分类占比饼图 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-sm font-semibold text-gray-800 mb-0.5">支出分类占比</p>
            <p className="text-xs text-content-tertiary mb-3">
              {timeFilter.label} 各类别支出比例
            </p>
            <CategoryPieChart bills={selectedMonthBills} />
          </div>

          {/* ④ 分类支出排行榜 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">分类支出排行</p>
            <ExpenseRankingList
              bills={selectedMonthBills}
              topN={8}
              currency={currency}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default ReportPage
