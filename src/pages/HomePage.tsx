// 首页 — S7 全面实时化：Firestore onSnapshot 驱动，骨架屏 Loading
// 数据流：Firestore → onSnapshot → billStore/ledgerStore → useBills → UI

import { useState, useMemo } from 'react'
import {
  StatCardsSkeleton,
  ChartSkeleton,
  BillListSkeleton,
} from '@/components/ui/Skeleton'
import ImportModal           from '@/components/import/ImportModal'
import LedgerSwitcher        from '@/components/ledger/LedgerSwitcher'
import LedgerManagerModal    from '@/components/ledger/LedgerManagerModal'
import CorrectionPolicyModal from '@/components/ledger/CorrectionPolicyModal'
import OmniInputModal        from '@/components/input/OmniInputModal'
import MonthlyBarChart       from '@/components/statistics/MonthlyBarChart'
import CategoryPieChart      from '@/components/statistics/CategoryPieChart'
import StatCards             from '@/components/statistics/StatCards'
import BudgetProgressBar     from '@/components/statistics/BudgetProgressBar'
import ExpenseRankingList    from '@/components/statistics/ExpenseRankingList'

// 业务 Hook（订阅 Zustand Store，替代所有 Mock 常量）
import { useBills }     from '@/hooks/useBills'
import { useLedger }    from '@/hooks/useLedger'
import { useBillStats } from '@/hooks/useBillStats'

// 工具函数
import { formatAmount }  from '@/utils/numberUtils'
import { toChineseDate } from '@/utils/dateUtils'

// 搜索 + 主题
import ThemeToggle        from '@/components/ui/ThemeToggle'
import SearchBar          from '@/components/ui/SearchBar'
import { useSearchBills } from '@/hooks/useSearchBills'

// 类型
import type { Transaction }                        from '@/types/Transaction.types'
import type { CorrectionPolicy, CorrectionIntent } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// Toast — 轻量全局操作反馈（无第三方依赖）
// ─────────────────────────────────────────────────────────────
interface ToastData {
  msg:  string
  type: 'success' | 'warning' | 'error'
}

function Toast({ toast }: { toast: ToastData }) {
  const colorMap = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error:   'bg-red-500',
  }
  const iconMap = {
    success: '✅',
    warning: '⚠️',
    error:   '❌',
  }
  return (
    <div className={`
      fixed top-5 left-1/2 -translate-x-1/2 z-[100]
      px-4 py-2.5 rounded-2xl shadow-lg
      text-sm font-semibold text-white
      flex items-center gap-2
      animate-[slideUp_0.2s_ease-out]
      ${colorMap[toast.type]}
    `}>
      <span>{iconMap[toast.type]}</span>
      <span>{toast.msg}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 分类图标映射
// ─────────────────────────────────────────────────────────────
const CATEGORY_ICON: Record<string, { icon: string; bg: string }> = {
  '餐饮':     { icon: '🍜', bg: 'bg-orange-50'  },
  '交通':     { icon: '🚇', bg: 'bg-blue-50'    },
  '购物':     { icon: '🛍️', bg: 'bg-purple-50'  },
  '娱乐':     { icon: '🎮', bg: 'bg-pink-50'    },
  '医疗':     { icon: '💊', bg: 'bg-red-50'     },
  '居住':     { icon: '🏠', bg: 'bg-yellow-50'  },
  '教育':     { icon: '📚', bg: 'bg-cyan-50'    },
  '工资':     { icon: '💰', bg: 'bg-green-50'   },
  '副业收入': { icon: '💻', bg: 'bg-teal-50'    },
  '理财收益': { icon: '📈', bg: 'bg-emerald-50' },
  '转账':     { icon: '↔️', bg: 'bg-gray-50'    },
  '未分类':   { icon: '📋', bg: 'bg-slate-50'   },
}
const getCategoryMeta = (cat: string) => CATEGORY_ICON[cat] ?? { icon: '📋', bg: 'bg-gray-50' }

// ─────────────────────────────────────────────────────────────
// 子组件：单条账单行
// 交互：hover 显示 [🗑️删除] [✏️纠偏]，点击删除进入内联二次确认
// 删除路径：deleteOne(id) → Firestore deleteDoc → onSnapshot → Store → UI 自动消失
// ─────────────────────────────────────────────────────────────
interface BillItemProps {
  transaction: Transaction
  onCorrect:   (tx: Transaction) => void
  onDelete:    (id: string) => Promise<void>
}

function BillItem({ transaction: tx, onCorrect, onDelete }: BillItemProps) {
  const { icon, bg } = getCategoryMeta(tx.category)
  const isIncome     = tx.amount > 0

  // 内联二次确认状态机
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting,    setIsDeleting]    = useState(false)

  async function handleDeleteConfirm() {
    setIsDeleting(true)
    try {
      await onDelete(tx.id)
      // 不需要手动移除 — onSnapshot 会让该条从列表消失
    } catch {
      // 删除失败则退出确认态，让用户看到错误
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="flex items-center gap-3 py-3 px-1 group">

      {/* 分类图标 */}
      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0 text-lg`}>
        {icon}
      </div>

      {/* 描述 + 分类 + 日期 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-slate-800 truncate">
            {tx.description}
          </p>
          {/* 血缘标记：该账单是跨账套克隆副本时显示（SX 阶段完整实现） */}
          {tx.clonedFromId && tx.sourceLedgerId && (
            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5
                             bg-violet-50 text-violet-500 rounded-full border border-violet-100">
              ↗ 副本
            </span>
          )}
          {/* 人工修正标记 */}
          {tx.isManuallyEdited && (
            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5
                             bg-amber-50 text-amber-500 rounded-full border border-amber-100">
              已纠偏
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          <span>{tx.category}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span>{toChineseDate(tx.date)}</span>
          {/* 标签（最多显示 2 个） */}
          {tx.tags && tx.tags.length > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              {tx.tags.slice(0, 2).map(tag => (
                <span key={tag} className="mr-1 text-primary-400">#{tag}</span>
              ))}
            </>
          )}
        </p>
      </div>

      {/* ── 右侧操作区 ────────────────────────────────────── */}

      {/* 二次确认态：展开删除提示 */}
      {confirmDelete ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[11px] font-semibold text-red-500">确认删除?</span>
          {/* 确认 ✓ */}
          <button
            onClick={handleDeleteConfirm}
            disabled={isDeleting}
            title="确认删除"
            className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center
                       text-xs font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {isDeleting ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : '✓'}
          </button>
          {/* 取消 ✗ */}
          <button
            onClick={() => setConfirmDelete(false)}
            disabled={isDeleting}
            title="取消"
            className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center
                       text-xs font-bold hover:bg-gray-300 disabled:opacity-50 transition-colors"
          >
            ✗
          </button>
        </div>
      ) : (
        /* 正常态：hover 显示操作按钮 + 金额 */
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* 🗑️ 删除按钮（hover 可见，红色调） */}
          <button
            onClick={() => setConfirmDelete(true)}
            title="删除此账单"
            className="w-6 h-6 rounded-full bg-surface-overlay flex items-center justify-center
                       text-slate-500 hover:text-red-500 hover:bg-red-50
                       transition-all opacity-0 group-hover:opacity-100"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* ✏️ 纠偏按钮（hover 可见） */}
          <button
            onClick={() => onCorrect(tx)}
            title="纠偏分类"
            className="w-6 h-6 rounded-full bg-surface-overlay flex items-center justify-center
                       text-slate-500 hover:text-primary-600 hover:bg-primary-50
                       transition-all opacity-0 group-hover:opacity-100"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>

          {/* 金额 + 来源 */}
          <div className="text-right">
            <span className={`text-sm font-semibold tabular-nums
              ${isIncome ? 'text-income' : 'text-slate-800'}`}>
              {isIncome ? '+' : '-'}¥{formatAmount(Math.abs(tx.amount))}
            </span>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {tx.source === 'wechat'  ? '微信'   :
               tx.source === 'alipay'  ? '支付宝' :
               tx.source === 'manual'  ? '手动'   : '银行'}
            </p>
          </div>

        </div>
      )}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件：HomePage
// ─────────────────────────────────────────────────────────────
interface CorrectionCtx {
  tx:       Transaction
  field:    string
  oldValue: string
  newValue: string
}

function HomePage() {
  // ── 数据层：订阅 Zustand Store，账套切换时自动重渲染 ─────
  const {
    income, expense, net,
    thisMonthBills, allLedgerBills, totalCount,
    billsReady,
    correct, deleteOne,
  } = useBills()
  const { activeLedger } = useLedger()

  // ── 智慧看板数据：日均、分类占比、预算剩余、预计月支出 ──────────
  const {
    totalExpense, dailyAvg, budget, budgetRemaining,
    overrun, overrunAmount, projectedExpense,
    daysElapsed, daysInMonth, categorySlices,
  } = useBillStats()

  // ── 分类筛选状态（饼图扇区点击联动账单列表）────────────────────
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // ── 视图切换状态 ──────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<'detail' | 'stats'>('detail')

  // ── 图表折叠 / 展开所有账单 ──────────────────────────────
  const [chartCollapsed, setChartCollapsed] = useState(true)
  const [showAllBills,   setShowAllBills]   = useState(false)

  // ── 搜索状态（useSearchBills 在全月账单上做客户端过滤）───────
  const {
    searchQuery, setSearchQuery, clearSearch,
    filteredBills: searchedBills, isSearching, matchCount,
  } = useSearchBills(thisMonthBills)

  // 账单展示优先级：搜索 > 分类筛选 > 默认 8 条 / 展开全量
  const recentBills = useMemo(() => {
    if (isSearching)      return searchedBills
    if (selectedCategory) return thisMonthBills.filter(t => t.category === selectedCategory)
    return showAllBills ? thisMonthBills : thisMonthBills.slice(0, 8)
  }, [thisMonthBills, selectedCategory, isSearching, searchedBills, showAllBills])

  // ── Toast 状态 ────────────────────────────────────────────
  const [toast, setToast] = useState<ToastData | null>(null)
  function showToast(msg: string, type: ToastData['type'] = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── 弹窗状态 ──────────────────────────────────────────────
  const [importOpen,      setImportOpen]      = useState(false)
  const [correctionOpen,  setCorrectionOpen]  = useState(false)
  const [correctionCtx,   setCorrectionCtx]   = useState<CorrectionCtx | null>(null)
  const [omniOpen,        setOmniOpen]        = useState(false)
  const [managerOpen,     setManagerOpen]     = useState(false)

  // ── 点击账单行的纠偏按钮 ─────────────────────────────────
  function handleCorrect(tx: Transaction) {
    const newCat = tx.category === '未分类' ? '餐饮' : '未分类'
    setCorrectionCtx({ tx, field: '分类', oldValue: tx.category, newValue: newCat })
    setCorrectionOpen(true)
  }

  // ── 纠偏弹窗确认（async：等待 Firestore 写入后关闭弹窗，批量时弹 Toast）
  // 注意：CorrectionPolicyModal 内部 await 此函数，期间显示 ⏳ Loading
  async function handleCorrectionConfirm(policy: CorrectionPolicy): Promise<void> {
    if (!correctionCtx) return
    const intent: CorrectionIntent = {
      transactionId: correctionCtx.tx.id,
      field:         'category',
      oldValue:      correctionCtx.oldValue,
      newValue:      correctionCtx.newValue,
      policy,
    }
    const matchedCount = await correct(policy, intent)
    // 批量溯及既往时显示受影响计数 Toast
    if (policy === 'retroactive' && matchedCount > 1) {
      showToast(`已批量更新 ${matchedCount} 条历史记录`, 'success')
    }
    setCorrectionCtx(null)
    // 弹窗关闭由 CorrectionPolicyModal 内部 handleConfirm finally 负责
  }

  // ── 删除账单：调用 Firestore deleteDoc，绝不碰本地 Store ──
  // onSnapshot 会自动让该条从列表消失（单向数据流红线）
  async function handleDeleteBill(id: string): Promise<void> {
    await deleteOne(id)
    showToast('账单已删除', 'success')
  }

  return (
    <div className="page-container">

      {/* ══ 全局 Toast（操作反馈：删除 / 批量纠偏计数）══════ */}
      {toast && <Toast toast={toast} />}

      {/* ══ 顶部标题栏：账套切换器（已绑定 Store） ═══════════ */}
      <div className="flex items-center justify-between mb-4 pt-1">
        {/* LedgerSwitcher：S17 新增 onManage 回调，点击「管理账套」打开 LedgerManagerModal */}
        <LedgerSwitcher onManage={() => setManagerOpen(true)} />
        {/* 右侧工具栏：主题切换 + 账户头像 */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ThemeToggle />
          <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-base">
            👤
          </div>
        </div>
      </div>

      {/* ══ 主横幅卡片 ══ */}
      <div className="rounded-2xl px-4 py-3 mb-3 bg-gradient-to-br from-primary-700 to-primary-500 text-white shadow-fab">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-white/60 mb-0.5">
              本月净收支
              <span className="ml-1.5 px-1.5 py-0.5 bg-white/15 rounded-full text-[10px]">
                {activeLedger?.name ?? '加载中…'}
              </span>
            </p>
            <p className="text-2xl font-bold tracking-tight">
              <span className="text-base mr-0.5">{net >= 0 ? '+' : '−'}¥</span>
              {formatAmount(Math.abs(net))}
            </p>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-[10px] text-white/60">收入</p>
              <p className="text-sm font-semibold text-white/95">¥{formatAmount(income)}</p>
            </div>
            <div className="w-px bg-white/20" />
            <div>
              <p className="text-[10px] text-white/60">支出</p>
              <p className="text-sm font-semibold text-white/95">¥{formatAmount(expense)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ══ 三核心指标卡 ══ */}
      {billsReady ? (
        <div className="grid grid-cols-3 gap-2 mb-3">

          {/* 卡片①：本月总支出 */}
          <div className="card py-3 px-3">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-sm">📉</span>
              <p className="text-[10px] text-slate-500 truncate">本月支出</p>
            </div>
            <p className="text-sm font-bold text-rose-500 tabular-nums leading-tight">
              <span className="text-[10px] mr-0.5">¥</span>
              {totalExpense.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              共 {totalCount} 笔
            </p>
          </div>

          {/* 卡片②：日均开销 */}
          <div className="card py-3 px-3">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-sm">📆</span>
              <p className="text-[10px] text-slate-500 truncate">日均开销</p>
            </div>
            <p className="text-sm font-bold text-amber-600 tabular-nums leading-tight">
              <span className="text-[10px] mr-0.5">¥</span>
              {dailyAvg.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              已过 {daysElapsed}/{daysInMonth} 天
            </p>
          </div>

          {/* 卡片③：预算剩余 / 超支 */}
          <div className="card py-3 px-3">
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-sm">{overrun ? '⚠️' : '💰'}</span>
              <p className="text-[10px] text-slate-500 truncate">
                {overrun ? '已超支' : '预算剩余'}
              </p>
            </div>
            <p className={`text-sm font-bold tabular-nums leading-tight ${
              overrun ? 'text-red-500' : 'text-emerald-600'
            }`}>
              <span className="text-[10px] mr-0.5">¥</span>
              {(overrun ? overrunAmount : budgetRemaining)
                .toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              预算 ¥{budget.toLocaleString()}
            </p>
          </div>

        </div>
      ) : (
        /* 加载骨架 */
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="card py-3 px-3 animate-pulse">
              <div className="h-2 bg-gray-100 rounded mb-2 w-3/4" />
              <div className="h-4 bg-gray-100 rounded mb-1 w-1/2" />
              <div className="h-2 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* ══ 快捷操作（紧凑横排）══════════════════════════════ */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setImportOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5
                     py-2.5 rounded-xl bg-white border border-slate-100 shadow-sm
                     hover:shadow-card-md active:scale-[0.98] transition-all no-select"
        >
          <span className="text-base leading-none">📥</span>
          <span className="text-xs font-semibold text-slate-700">导入账单</span>
        </button>
        <button
          onClick={() => setOmniOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5
                     py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700
                     active:scale-[0.98] transition-all shadow-fab no-select"
        >
          <span className="text-base leading-none">✏️</span>
          <span className="text-xs font-semibold text-white">手动记账</span>
        </button>
      </div>


      {/* ══ 明细 / 统计 主 Tab 栏 ════════════════════════════ */}
      <div className="flex items-center gap-1.5 mb-4 p-1
                      bg-surface-overlay rounded-xl">
        <button
          onClick={() => setActiveSection('detail')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeSection === 'detail'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-600'
          }`}
        >
          📋 账单明细
        </button>
        <button
          onClick={() => setActiveSection('stats')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeSection === 'stats'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-600'
          }`}
        >
          📊 统计看板
        </button>
      </div>

      {/* ══ 统计看板视图（全景豪华版）════════════════════════ */}
      {activeSection === 'stats' && (
        <div className="space-y-4">

          {/* ─ 骨架屏：等待 Firestore 首次快照 ─ */}
          {!billsReady && (
            <>
              <StatCardsSkeleton />
              <ChartSkeleton height="h-5" />
              <ChartSkeleton height="h-44" />
              <ChartSkeleton height="h-36" />
            </>
          )}

          {/* ─ 真实数据（billsReady 后渲染）─ */}
          {billsReady && (<>

          {/* ① 核心数据卡片 — 三件套 KPI */}
          {/* 数据流：useBills → income/expense/net，账套切换时自动重传 */}
          <StatCards
            income={income}
            expense={expense}
            net={net}
            currency={activeLedger?.currency}
          />

          {/* ② 月度预算监控 */}
          {/* Mock 预算额度 by ledgerType，S9 阶段替换为 Firestore budgets 集合 */}
          <div className="card">
            <BudgetProgressBar
              expense={expense}
              ledgerType={activeLedger?.type ?? 'personal'}
              currency={activeLedger?.currency}
            />
          </div>

          {/* ③ 月度收支趋势图 */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-800">月度收支趋势</h2>
              <span className="text-[11px] text-slate-500 px-2 py-0.5
                               bg-surface-overlay rounded-full">最近 6 个月</span>
            </div>
            {/* allLedgerBills：跨月全量 + 已按 activeLedgerId 隔离 */}
            <MonthlyBarChart bills={allLedgerBills} />
          </div>

          {/* ④ 分类支出排行榜 */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-800">支出碎钞机 Top 5</h2>
              <span className="text-[11px] text-slate-500">本月 · 相对排名</span>
            </div>
            {/* thisMonthBills：本月 + 已按 activeLedgerId 隔离 */}
            <ExpenseRankingList
              bills={thisMonthBills}
              topN={5}
              currency={activeLedger?.currency}
            />
          </div>

          {/* ⑤ 消费分类环形图 */}
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-800">支出分类占比</h2>
              <span className="text-[11px] text-primary-500 font-medium">
                {activeLedger?.name ?? '—'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              本月支出合计 · 排除转账类别
            </p>
            <CategoryPieChart bills={thisMonthBills} />
          </div>

          {/* ⑥ 预支出管理 — 占位（S9 点亮） */}
          <div className="card border border-dashed border-gray-200 opacity-60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-base flex-shrink-0">
                📅
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-800">预支出管理</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  待发生账单 · 垫资报销追踪 · 自定义预算设置
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5
                               bg-amber-100 text-amber-600 rounded-full flex-shrink-0">
                🚧 S9
              </span>
            </div>
          </div>

          </>)}  {/* end billsReady */}
        </div>
      )}

      {/* ══ 账单明细视图 ══════════════════════════════════════ */}
      {activeSection === 'detail' && (
        <>
          {/* ── 消费分类图（细条折叠栏，默认收起）── */}
          {billsReady && categorySlices.length > 0 && (
            <div className="mb-3">
              {/* 折叠触发条 — 极小占位 */}
              <button
                onClick={() => setChartCollapsed(v => !v)}
                className="w-full flex items-center justify-between
                           px-3 py-2 bg-white rounded-xl border border-slate-100 shadow-sm
                           hover:bg-slate-50 transition-colors"
              >
                <span className="text-xs font-medium text-slate-600">📊 本月消费分布</span>
                <span className="text-[11px] text-primary-600 font-semibold">
                  {chartCollapsed ? '展开 ›' : '收起 ‹'}
                </span>
              </button>
              {/* 展开后才渲染图表，完全不占空间 */}
              {!chartCollapsed && (
                <div className="card mt-1 pt-3">
                  <CategoryPieChart
                    bills={thisMonthBills}
                    onCategoryClick={setSelectedCategory}
                    selectedCategory={selectedCategory}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── 账单搜索栏 ─────────────────────────────────── */}
          {billsReady && (
            <div className="mb-3">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={clearSearch}
                matchCount={matchCount}
                isSearching={isSearching}
              />
            </div>
          )}

          {/* 最近账单列表 — 骨架屏 */}
          {!billsReady && <BillListSkeleton rows={5} />}

          {/* 最近账单列表 */}
          {billsReady && <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-800">
                {isSearching      ? `搜索「${searchQuery}」`          :
                 selectedCategory ? `「${selectedCategory}」账单`     : '最近账单'}
              </h2>
              <button
                onClick={() => { setShowAllBills(true); setSelectedCategory(null) }}
                className="text-xs text-primary-600 font-medium hover:underline"
              >
                查看全部 ›
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {isSearching
                ? `找到 ${matchCount} 条匹配记录`
                : selectedCategory
                  ? `本月 ${selectedCategory} 共 ${recentBills.length} 笔 · 点击环形图空白区可清除筛选`
                  : `本月共 ${totalCount} 笔记录 · 悬停可纠偏分类`}
            </p>

            <div>
              {recentBills.length > 0 ? (
                recentBills.map((tx, index) => (
                  <div key={tx.id}>
                    <BillItem
                      transaction={tx}
                      onCorrect={handleCorrect}
                      onDelete={handleDeleteBill}
                    />
                    {index < recentBills.length - 1 && (
                      <div className="divider ml-14" />
                    )}
                  </div>
                ))
              ) : (
                <div className="py-10 text-center">
                  <p className="text-3xl mb-2">{isSearching ? '🔍' : '📋'}</p>
                  <p className="text-sm text-slate-500">
                    {isSearching
                      ? `未找到含「${searchQuery}」的账单`
                      : `「${activeLedger?.name}」本月暂无账单`}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 opacity-70">
                    {isSearching ? '试试其他关键词' : '导入账单或手动记账后显示'}
                  </p>
                </div>
              )}
            </div>

            {/* 无分类筛选时才展示"还有 X 条"提示 */}
            {!selectedCategory && !showAllBills && totalCount > 8 && (
              <button
                onClick={() => setShowAllBills(true)}
                className="w-full mt-3 py-2.5 text-xs text-primary-600 font-medium
                           bg-primary-50 rounded-lg text-center hover:bg-primary-100
                           transition-colors"
              >
                还有 {totalCount - 8} 条记录，点击展开全部 ›
              </button>
            )}
            {/* 展开全量时显示收起按钮 */}
            {showAllBills && totalCount > 8 && (
              <button
                onClick={() => setShowAllBills(false)}
                className="w-full mt-3 py-2.5 text-xs text-slate-500
                           bg-surface-overlay rounded-lg text-center hover:bg-gray-100
                           transition-colors"
              >
                收起 ‹
              </button>
            )}
          </div>}
        </>
      )}

      {/* ══ FAB：全能记账入口（右下角悬浮按钮）══════════════ */}
      <button
        onClick={() => setOmniOpen(true)}
        className="fixed bottom-20 right-5 z-30
                   w-14 h-14 rounded-full bg-primary-600 text-white
                   flex items-center justify-center text-2xl
                   shadow-fab hover:bg-primary-700 active:scale-95
                   transition-all duration-150"
        title="记一笔"
        aria-label="记一笔"
      >
        ＋
      </button>

      {/* ══ 弹窗挂载区 ════════════════════════════════════════ */}
      <OmniInputModal
        isOpen={omniOpen}
        onClose={() => setOmniOpen(false)}
        showToast={showToast}
      />
      <ImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <CorrectionPolicyModal
        isOpen={correctionOpen}
        onClose={() => { setCorrectionOpen(false); setCorrectionCtx(null) }}
        onConfirm={handleCorrectionConfirm}
        field={correctionCtx?.field ?? '分类'}
        oldValue={correctionCtx?.oldValue ?? ''}
        newValue={correctionCtx?.newValue ?? ''}
      />

      {/* S17：账套管理中心弹窗（从 LedgerSwitcher "管理账套" 按钮触发） */}
      <LedgerManagerModal
        isOpen={managerOpen}
        onClose={() => setManagerOpen(false)}
      />

    </div>
  )
}

export default HomePage
