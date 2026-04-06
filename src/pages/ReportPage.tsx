// ReportPage — 财务报表页 (S19 全功能版)
//
// 功能：
//   ① 月份切换器（最近 6 个月，默认本月）
//   ② StatCards：所选月收入 / 支出 / 净结余
//   ③ MonthlyBarChart：全账套近 6 个月趋势（不受月份切换影响，展示完整趋势）
//   ④ CategoryPieChart：所选月支出分类占比
//   ⑤ ExpenseRankingList：所选月支出分类排行

import { useState, useMemo } from 'react'
import { useBills }          from '@/hooks/useBills'
import { useLedgerStore }    from '@/store/ledgerStore'
import { useBillStore }      from '@/store/billStore'

import StatCards          from '@/components/statistics/StatCards'
import MonthlyBarChart    from '@/components/statistics/MonthlyBarChart'
import CategoryPieChart   from '@/components/statistics/CategoryPieChart'
import ExpenseRankingList from '@/components/statistics/ExpenseRankingList'

// ── 月份工具函数 ────────────────────────────────────────────────

interface MonthOption {
  key:   string   // YYYY-MM
  label: string   // 展示文字，如"4月"；本月加 "(本月)"
}

/** 生成最近 N 个月的月份选项，最新在前 */
function buildMonthOptions(n = 6): MonthOption[] {
  const options: MonthOption[] = []
  const now = new Date()
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const shortLabel = `${d.getMonth() + 1}月`
    options.push({
      key,
      label: key === thisMonthKey ? `${shortLabel} · 本月` : shortLabel,
    })
  }
  return options   // 最新在前（index 0 = 本月）
}

// ── 主组件 ─────────────────────────────────────────────────────

function ReportPage() {
  // 月份选项列表（常量，不依赖账套）
  const monthOptions = useMemo(() => buildMonthOptions(6), [])

  // 当前选中的月份（默认本月）
  const [selectedMonth, setSelectedMonth] = useState<string>(monthOptions[0].key)

  // 账套货币（传给 StatCards / ExpenseRankingList）
  const activeLedger = useLedgerStore(s => s.ledgers.find(l => l.id === s.activeLedgerId))
  const currency     = activeLedger?.currency ?? 'CNY'

  // 账单数据（全量 + ready 状态）
  const allLedgerBills = useBillStore(s => s._allTransactions)
  const billsReady     = useBillStore(s => s.billsReady)

  // 当前选中月份的账单（StatCards / PieChart / RankingList 使用）
  const selectedMonthBills = useMemo(() =>
    allLedgerBills.filter(
      tx => tx.status !== 'void' && tx.date.startsWith(selectedMonth)
    ),
    [allLedgerBills, selectedMonth]
  )

  // 所选月份的收支汇总（StatCards props）
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

      {/* ── 标题 ──────────────────────────────────────────────── */}
      <div className="pt-2">
        <h1 className="text-xl font-bold text-gray-900">财务报表</h1>
        <p className="text-xs text-gray-400 mt-1">可视化收支结构与趋势</p>
      </div>

      {/* ── 月份切换器 ─────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
        {monthOptions.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSelectedMonth(opt.key)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium
                        transition-colors whitespace-nowrap ${
              selectedMonth === opt.key
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

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
            <p className="text-xs text-gray-400 mb-3">
              {monthOptions.find(o => o.key === selectedMonth)?.label ?? selectedMonth} 各类别支出比例
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
