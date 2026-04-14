// 首页 — S7 全面实时化：Firestore onSnapshot 驱动，骨架屏 Loading
// 数据流：Firestore → onSnapshot → billStore/ledgerStore → useBills → UI

import { useState, useMemo } from 'react'
import { useNavigate }       from 'react-router-dom'
import {
  StatCardsSkeleton,
  ChartSkeleton,
  BillListSkeleton,
} from '@/components/ui/Skeleton'
import ImportModal           from '@/components/import/ImportModal'
import LedgerSwitcher        from '@/components/ledger/LedgerSwitcher'
import LedgerManagerModal    from '@/components/ledger/LedgerManagerModal'
import CorrectionPolicyModal from '@/components/ledger/CorrectionPolicyModal'
import OmniInputModal, { type EditSaveData }  from '@/components/input/OmniInputModal'
import TransactionDetailModal                 from '@/components/ui/TransactionDetailModal'
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

// 批量删除服务
import { batchDeleteTransactionsDeep } from '@/services/firebase/billService'
import { updateTransaction }           from '@/services/firebase/billService'

// 共享 UI 组件
import { ThumbnailImage } from '@/components/ui/StorageImage'
import { StorageImage }   from '@/components/ui/StorageImage'

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
  onDetail:    (tx: Transaction) => void   // 点击主体区域 → 只读详情卡片
  isSelected:  boolean
  onToggle:    (id: string) => void
}

function BillItem({ transaction: tx, onCorrect, onDelete, onDetail, isSelected, onToggle }: BillItemProps) {
  const { icon, bg } = getCategoryMeta(tx.category)
  const isIncome = tx.amount > 0

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const receipts = tx.receiptUrls ?? []

  const rawLegacy = tx.rawData?.['legacy_backup'] as Record<string, unknown> | undefined
  // For V2 migrated records, tx.description was incorrectly set to category name as fallback.
  // The real summary lives in rawData.legacy_backup.summary.
  // Priority: legacy_backup.summary > tx.description (only if it differs from category) > category
  const legacySummary = rawLegacy?.['summary'] as string | undefined
  const descNotCategory = tx.description !== tx.category ? tx.description : ''
  const displayDesc = legacySummary || descNotCategory || tx.description || '无摘要'

  const amountColor = isIncome ? 'text-income' : 'text-expense'
  const sourceLabel =
    tx.source === 'wechat'  ? '微信'   :
    tx.source === 'alipay'  ? '支付宝' :
    tx.source === 'manual'  ? '手动'   : '银行'

  async function handleDeleteConfirm() {
    setIsDeleting(true)
    try {
      await onDelete(tx.id)
    } catch {
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <>
      {lightboxOpen && receipts[0] && (
        <div
          className="fixed inset-0 z-[700] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/15 text-white text-xl hover:bg-white/25 z-10"
            onClick={() => setLightboxOpen(false)}
          >
            ×
          </button>
          <StorageImage
            path={receipts[0]}
            alt="receipt"
            className="max-w-[92vw] max-h-[82vh] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      <div className={`flex items-center gap-2 py-2 px-2 group transition-colors ${isSelected ? 'bg-surface-overlay' : ''}`}>

        <div className="flex-shrink-0 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggle(tx.id)}
            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
              isSelected
                ? 'bg-primary-600 border-primary-600'
                : 'border-slate-400 hover:border-primary-500'
            }`}
            aria-label="select"
          >
            {isSelected && (
              <svg className="w-2.5 h-2.5 text-content-inverse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0 overflow-hidden text-xs leading-none`}>
            {icon}
          </div>
        </div>

        {/* 中间内容区：点击 → 只读详情卡片（非功能区点击缓冲）*/}
        <div
          className="flex-1 min-w-0 overflow-hidden cursor-pointer"
          onClick={() => onDetail(tx)}
        >
          <p className="text-[13px] font-bold text-slate-800 truncate leading-snug">{displayDesc}</p>
          {tx.remark ? (
            <p className="text-[10px] text-content-secondary truncate mt-px leading-snug italic">💬 {tx.remark}</p>
          ) : null}
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className="text-[10px] text-content-tertiary">{tx.category}</span>
            <span className="text-[10px] text-content-tertiary opacity-40">·</span>
            <span className="text-[10px] text-content-tertiary">{toChineseDate(tx.date)}</span>
            {tx.sourceType === 'V2_to_V3' && (
              <span className="text-[9px] font-semibold px-1 py-px rounded bg-indigo-50 text-indigo-500 border border-indigo-100">V2</span>
            )}
            {tx.isManuallyEdited && (
              <span className="text-[9px] font-semibold px-1 py-px rounded bg-amber-50 text-amber-500 border border-amber-100">纠偏</span>
            )}
            {tx.clonedFromId && tx.sourceLedgerId && (
              <span className="text-[9px] font-semibold px-1 py-px rounded bg-violet-50 text-violet-500 border border-violet-100">副本</span>
            )}
            {tx.tags && tx.tags.slice(0, 2).map(tag => (
              <span key={tag} className="text-[9px] text-primary-400">#{tag}</span>
            ))}
          </div>
        </div>

        {/* 右侧固定宽度容器：缩略图 + 操作按钮 + 金额，强制靠右垂直对齐 */}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          <ThumbnailImage
            urls={receipts}
            sizeClass="w-9 h-9"
            onClick={e => { e.stopPropagation(); setLightboxOpen(true) }}
          />

          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold text-red-500">确认?</span>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {isDeleting ? (
                  <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : '✓'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                className="w-5 h-5 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >✗</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setConfirmDelete(true)}
                title="delete"
                className="w-5 h-5 rounded-full flex items-center justify-center text-content-tertiary hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button
                onClick={() => onCorrect(tx)}
                title="correct"
                className="w-5 h-5 rounded-full flex items-center justify-center text-content-tertiary hover:text-primary-600 hover:bg-primary-50 transition-all opacity-0 group-hover:opacity-100"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <div className="text-right" style={{ minWidth: '56px' }}>
                <p className={`text-sm font-bold tabular-nums ${amountColor}`}>
                  {isIncome ? '+' : '\u2212'}¥{formatAmount(Math.abs(tx.amount))}
                </p>
                <p className="text-[9px] text-content-tertiary">{sourceLabel}</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
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
  const navigate = useNavigate()

  // ── 数据层：订阅 Zustand Store，账套切换时自动重渲染 ─────
  const {
    income, expense, net,
    thisMonthBills, allLedgerBills, totalCount,
    billsReady,
    correct, deleteOne,
  } = useBills()
  const { activeLedger } = useLedger()

  // ── 全量活跃账单（非作废，全时间范围，最新优先）用于账单列表展示 ──
  // 主要解决：历史迁移数据（如 V2→V3）日期在往月，thisMonthBills 无法展示
  //
  // 隔离规则：_migratedFromV2=true 且 isVerified≠true 的账单属于"待审核"队列
  // 这批数据只在冲突中心可见，未经 forceAdd 审核前严禁出现在首页
  const allActiveBills = useMemo(() =>
    allLedgerBills
      .filter(t => t.status !== 'void')
      .filter(t => !(t.rawData['_migratedFromV2'] === true && t.isVerified !== true))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [allLedgerBills]
  )
  const allActiveBillsCount = allActiveBills.length

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

  // ── 搜索状态（在全账套账单上做客户端过滤，覆盖历史数据）──────
  const {
    searchQuery, setSearchQuery, clearSearch,
    filteredBills: searchedBills, isSearching, matchCount,
  } = useSearchBills(allActiveBills)

  // 账单展示优先级：搜索 > 分类筛选 > 默认 8 条 / 展开全量
  // 使用 allActiveBills（全时间）而非 thisMonthBills，确保历史迁移数据可见
  const recentBills = useMemo(() => {
    if (isSearching)      return searchedBills
    if (selectedCategory) return allActiveBills.filter(t => t.category === selectedCategory)
    return showAllBills ? allActiveBills : allActiveBills.slice(0, 8)
  }, [allActiveBills, selectedCategory, isSearching, searchedBills, showAllBills])

  // ── Toast 状态 ────────────────────────────────────────────
  const [toast, setToast] = useState<ToastData | null>(null)
  function showToast(msg: string, type: ToastData['type'] = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── 批量选择状态 ──────────────────────────────────────────
  const [selectedIds,     setSelectedIds]     = useState<Set<string>>(new Set())
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)
  const [batchProgress,   setBatchProgress]   = useState<{ done: number; total: number } | null>(null)

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleSelectAll = () => {
    const visibleIds = recentBills.map(t => t.id)
    const allSelected = visibleIds.every(id => selectedIds.has(id))
    if (allSelected) {
      // 全部已选 → 全部取消
      setSelectedIds(new Set())
    } else {
      // 否则 → 选中全部可见账单
      setSelectedIds(new Set(visibleIds))
    }
  }

  // 批量物理删除：Transaction + evidences Firestore 文档 + Storage 文件
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    const confirmed = window.confirm(
      `确认永久删除选中的 ${ids.length} 条账单？\n\n` +
      `· 账单文档将从 Firestore 移除\n` +
      `· 关联凭证文件将从 Firebase Storage 物理删除\n\n` +
      `此操作不可撤销！`
    )
    if (!confirmed) return

    setIsBatchDeleting(true)
    setBatchProgress({ done: 0, total: ids.length })
    try {
      const result = await batchDeleteTransactionsDeep(ids, (done, total) => {
        setBatchProgress({ done, total })
      })
      setSelectedIds(new Set())
      if (result.errors.length === 0) {
        showToast(`✅ 已删除 ${result.deleted} 条账单（含 Storage 文件）`, 'success')
      } else {
        showToast(`⚠️ 删除 ${result.deleted} 条成功，${result.errors.length} 条失败`, 'warning')
      }
    } catch (e) {
      showToast('批量删除失败，请重试', 'error')
      console.error('[HomePage] 批量删除异常:', e)
    } finally {
      setIsBatchDeleting(false)
      setBatchProgress(null)
    }
  }

  // 解绑凭证：清空选中账单的 receiptUrls（保留 Storage 文件，保留账单）
  const handleUnbindReceipts = async () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    const confirmed = window.confirm(
      `确认解绑选中 ${ids.length} 条账单的凭证关联？\n\n` +
      `· 仅清除账单上的照片链接，不删除 Storage 文件\n` +
      `· 账单本体保留`
    )
    if (!confirmed) return
    try {
      await Promise.all(ids.map(id => updateTransaction(id, { receiptUrls: [] })))
      setSelectedIds(new Set())
      showToast(`✅ 已解绑 ${ids.length} 条账单的凭证`, 'success')
    } catch (e) {
      showToast('解绑失败，请重试', 'error')
      console.error('[HomePage] 解绑凭证异常:', e)
    }
  }

  // ── 弹窗状态 ──────────────────────────────────────────────
  const [importOpen,      setImportOpen]      = useState(false)
  const [correctionOpen,  setCorrectionOpen]  = useState(false)
  const [correctionCtx,   setCorrectionCtx]   = useState<CorrectionCtx | null>(null)
  const [omniOpen,        setOmniOpen]        = useState(false)
  const [managerOpen,     setManagerOpen]     = useState(false)
  const [editTx,          setEditTx]          = useState<Transaction | null>(null)
  const [detailTx,        setDetailTx]        = useState<Transaction | null>(null)

  // ── 点击铅笔按钮：打开修改弹窗（预填数据）────────────────
  function handleCorrect(tx: Transaction) {
    setEditTx(tx)
    setOmniOpen(true)
  }

  // ── OmniInputModal 关闭（同时清空 editTx + detailTx，斩断循环路径）──
  // 保证：Detail → Edit → Save/Cancel 后直接落地 HomePage，不回弹 DetailModal
  function handleOmniClose() {
    setOmniOpen(false)
    setEditTx(null)
    setDetailTx(null)   // 防御性清空：即使已是 null，无副作用
  }

  // ── 编辑模式保存：严格三层物理隔离 ─────────────────────────
  //
  //  Layer 1  金额/说明/备注/日期变更（同收支类型，分类未变）→ 静默保存
  //  Layer 2  收支类型互转（expense ↔ income）             → 静默保存（含自动分类，绝不弹窗）
  //  Layer 3  同收支类型下用户主动改了分类                  → 唯一允许弹出 CorrectionPolicyModal
  //
  //  判断顺序：typeChanged 优先，阻断 Layer 3 的误触发
  //  类型检测：用 amount 正负号推断，无需额外字段
  // ──────────────────────────────────────────────────────────
  async function handleSaveEdit(data: EditSaveData): Promise<void> {
    if (!editTx) return

    // 共用写入 patch（全字段合并，category 留到各分支按需追加）
    const basePatch = {
      amount:           data.amount,
      date:             data.date,
      description:      data.description,
      remark:           data.remark,
      isManuallyEdited: true,
      ...(editTx.rawData?.['_migratedFromV2'] === true ? { isVerified: true } : {}),
    }

    // ── 收支类型检测：正数=收入，负数=支出 ──────────────────
    // 正常路径：OmniInputModal 内部已通过 window.confirm 拦截并让用户确认，
    // 到达此处时用户已明确知晓类型已切换，直接静默全量保存，绝不弹窗。
    const originalIsIncome = editTx.amount > 0
    const newIsIncome      = data.amount > 0
    const typeChanged      = originalIsIncome !== newIsIncome

    // ══ Layer 2：收支互转 → 静默全量保存（含新分类），严禁弹窗 ══
    if (typeChanged) {
      await updateTransaction(editTx.id, { ...basePatch, category: data.category })
      showToast('✅ 已切换收支类型并保存', 'success')
      setEditTx(null)
      return
    }

    // ── 同收支类型下：检测分类是否改变 ──────────────────────
    const categoryChanged = data.category !== editTx.category

    // ══ Layer 1：分类未变 → 静默全量保存 ══
    if (!categoryChanged) {
      await updateTransaction(editTx.id, { ...basePatch, category: data.category })
      showToast('✅ 修改成功', 'success')
      setEditTx(null)
      return
    }

    // ══ Layer 3：同类型 + 分类改变 → 先保存非分类字段，再弹出策略选择 ══
    await updateTransaction(editTx.id, basePatch)
    setCorrectionCtx({
      tx:       editTx,
      field:    '分类',
      oldValue: editTx.category,
      newValue: data.category,
    })
    setEditTx(null)
    setCorrectionOpen(true)
  }

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
    if (policy === 'retroactive' && matchedCount > 1) {
      showToast(`已批量更新 ${matchedCount} 条历史记录`, 'success')
    } else {
      showToast('✅ 分类规则已应用', 'success')
    }
    setCorrectionCtx(null)
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
                onClick={() => navigate('/query')}
                className="text-xs text-primary-600 font-medium hover:underline"
              >
                查看全部 ›
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              {isSearching
                ? `找到 ${matchCount} 条匹配记录`
                : selectedCategory
                  ? `${selectedCategory} 共 ${recentBills.length} 笔 · 点击环形图空白区可清除筛选`
                  : `账套共 ${allActiveBillsCount} 条账单 · 悬停可纠偏分类`}
            </p>

            {/* ── 批量操作工具栏 ── */}
            <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-slate-100">

              {/* 全选 / 取消全选 */}
              <button
                onClick={handleSelectAll}
                disabled={isBatchDeleting || recentBills.length === 0}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                            transition-colors disabled:opacity-40 ${
                  recentBills.length > 0 && recentBills.every(t => selectedIds.has(t.id))
                    ? 'bg-primary-100 text-primary-700 border border-primary-300'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {recentBills.length > 0 && recentBills.every(t => selectedIds.has(t.id))
                  ? '✓ 全选'
                  : '全选'}
                {selectedIds.size > 0 && ` (${selectedIds.size})`}
              </button>

              {/* 删除（含 Storage 清理）*/}
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0 || isBatchDeleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                           transition-colors disabled:opacity-40
                           bg-red-50 text-red-600 border border-red-200
                           hover:bg-red-100 disabled:hover:bg-red-50"
              >
                {isBatchDeleting
                  ? `删除中 ${batchProgress ? `${batchProgress.done}/${batchProgress.total}` : '…'}`
                  : `🗑 删除${selectedIds.size > 0 ? `(${selectedIds.size})` : ''}`}
              </button>

              {/* 撤销 / 清除选择 */}
              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0 || isBatchDeleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                           transition-colors disabled:opacity-40
                           bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                ↩ 撤销
              </button>

              {/* 解绑凭证（清空 receiptUrls，保留账单）*/}
              <button
                onClick={handleUnbindReceipts}
                disabled={selectedIds.size === 0 || isBatchDeleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                           transition-colors disabled:opacity-40
                           bg-amber-50 text-amber-700 border border-amber-200
                           hover:bg-amber-100 disabled:hover:bg-amber-50"
              >
                🔗 解绑
              </button>

            </div>{/* end 批量操作工具栏 */}

            <div>
              {recentBills.length > 0 ? (
                recentBills.map((tx, index) => (
                  <div key={tx.id}>
                    <BillItem
                      transaction={tx}
                      onCorrect={handleCorrect}
                      onDelete={handleDeleteBill}
                      onDetail={setDetailTx}
                      isSelected={selectedIds.has(tx.id)}
                      onToggle={toggleSelect}
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
                      : `「${activeLedger?.name}」暂无账单`}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 opacity-70">
                    {isSearching ? '试试其他关键词' : '导入账单或手动记账后显示'}
                  </p>
                </div>
              )}
            </div>

            {/* 无分类筛选时才展示"还有 X 条"提示 */}
            {!selectedCategory && !showAllBills && allActiveBillsCount > 8 && (
              <button
                onClick={() => setShowAllBills(true)}
                className="w-full mt-3 py-2.5 text-xs text-primary-600 font-medium
                           bg-primary-50 rounded-lg text-center hover:bg-primary-100
                           transition-colors"
              >
                还有 {allActiveBillsCount - 8} 条记录，点击展开全部 ›
              </button>
            )}
            {/* 展开全量时显示收起按钮 */}
            {showAllBills && allActiveBillsCount > 8 && (
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

      {/* 账单只读详情卡片（点击账单行主体区域触发，编辑按钮再开修改表单）*/}
      <TransactionDetailModal
        tx={detailTx}
        onClose={() => setDetailTx(null)}
        onEdit={tx => { setDetailTx(null); handleCorrect(tx) }}
      />

      <OmniInputModal
        isOpen={omniOpen}
        onClose={handleOmniClose}
        showToast={showToast}
        editTx={editTx ?? undefined}
        onSaveEdit={handleSaveEdit}
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
