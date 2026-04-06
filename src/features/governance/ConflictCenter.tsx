// 冲突与治理中心 — S21 核心 UI
// 检测账套内三类数据质量问题：重复账单 / 待验证迁移数据 / 缺凭证记录
// 提供三种处置动作：强制入账 / 作废 / 合并
//
// 数据流：billStore._allTransactions → detectConflicts() → 渲染列表
// 操作流：UI 触发 → governanceService → Firestore → onSnapshot → Store → UI 刷新

import { useState, useMemo }       from 'react'
import { useBills }                from '@/hooks/useBills'
import { useAuthStore }            from '@/store/authStore'
import { useGovernanceStore }      from '@/store/governanceStore'
import {
  forceAdd,
  archiveTransaction,
  mergeTransactions,
} from '@/services/firebase/governanceService'
import { formatAmount }            from '@/utils/numberUtils'
import type { Transaction }        from '@/types/Transaction.types'

// ════════════════════════════════════════════════════════════════
// § 1  冲突类型定义
// ════════════════════════════════════════════════════════════════

type ConflictType   = 'duplicate' | 'pending' | 'no_evidence'
type ConflictFilter = 'all' | ConflictType

interface ConflictItem {
  tx:           Transaction
  conflictType: ConflictType
}

// ── 显示文案 ─────────────────────────────────────────────────────
const CONFLICT_LABEL: Record<ConflictType, string> = {
  duplicate:   '重复',
  pending:     '待验证',
  no_evidence: '缺凭证',
}

// ── 色彩方案（背景 + 文字）────────────────────────────────────────
const CONFLICT_BADGE: Record<ConflictType, string> = {
  duplicate:   'bg-red-100 text-red-700',
  pending:     'bg-yellow-100 text-yellow-700',
  no_evidence: 'bg-blue-100 text-blue-700',
}

// ── 强调色（用于筛选激活态等）────────────────────────────────────
const CONFLICT_RING: Record<ConflictType, string> = {
  duplicate:   'ring-red-400',
  pending:     'ring-yellow-400',
  no_evidence: 'ring-blue-400',
}

// ════════════════════════════════════════════════════════════════
// § 2  冲突检测函数
// ════════════════════════════════════════════════════════════════

/**
 * detectConflicts — 从账单列表中提取所有需要治理的冲突记录
 *
 * 优先级（互斥）：
 *   1. isDuplicate === true                              → 重复
 *   2. V2迁移 + 未核实                                  → 待验证
 *   3. V2迁移 + 已核实 + 无凭证                         → 缺凭证
 *
 * 已作废（status='void'）的账单不参与检测
 */
function detectConflicts(bills: Transaction[]): ConflictItem[] {
  const result: ConflictItem[] = []

  for (const tx of bills) {
    if (tx.status === 'void') continue

    const isMigrated = tx.rawData['_migratedFromV2'] === true

    if (tx.isDuplicate === true) {
      result.push({ tx, conflictType: 'duplicate' })
    } else if (isMigrated && tx.isVerified !== true) {
      result.push({ tx, conflictType: 'pending' })
    } else if (
      isMigrated &&
      tx.isVerified === true &&
      (!tx.receiptUrls || tx.receiptUrls.length === 0)
    ) {
      result.push({ tx, conflictType: 'no_evidence' })
    }
  }

  // 按日期倒序排列（最新冲突优先展示）
  return result.sort((a, b) => b.tx.date.localeCompare(a.tx.date))
}

// ════════════════════════════════════════════════════════════════
// § 3  子组件：筛选条
// ════════════════════════════════════════════════════════════════

interface FilterBarProps {
  filter:   ConflictFilter
  counts:   Record<ConflictFilter, number>
  onChange: (f: ConflictFilter) => void
}

function ConflictFilterBar({ filter, counts, onChange }: FilterBarProps) {
  const options: Array<{ key: ConflictFilter; label: string }> = [
    { key: 'all',         label: '全部'   },
    { key: 'duplicate',   label: '重复'   },
    { key: 'pending',     label: '待验证' },
    { key: 'no_evidence', label: '缺凭证' },
  ]

  return (
    <div className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none border-b border-border-primary">
      {options.map(({ key, label }) => {
        const isActive = filter === key
        const count    = counts[key]
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={[
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full',
              'text-xs font-medium transition-colors',
              isActive
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary',
            ].join(' ')}
          >
            <span>{label}</span>
            {count > 0 && (
              <span className={[
                'inline-flex items-center justify-center min-w-[16px] h-4 px-1',
                'rounded-full text-[10px] font-bold',
                isActive
                  ? 'bg-white/25 text-white'
                  : 'bg-content-tertiary/15 text-content-secondary',
              ].join(' ')}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 4  子组件：冲突账单卡片
// ════════════════════════════════════════════════════════════════

interface ConflictCardProps {
  item:          ConflictItem
  isSelected:    boolean
  /** 合并模式下：此卡是合并的发起方（半透明显示） */
  isMergeSource: boolean
  /** 当前全局处于合并等待模式 */
  isMergeMode:   boolean
  onClick:       () => void
}

function ConflictCard({
  item, isSelected, isMergeSource, isMergeMode, onClick,
}: ConflictCardProps) {
  const { tx, conflictType } = item
  const isExpense = tx.amount < 0

  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left px-4 py-3 border-b border-border-primary',
        'transition-all duration-150',
        // 选中样式
        isSelected && !isMergeMode
          ? 'bg-primary-50 border-l-[3px] border-l-primary-500'
          : 'bg-surface-primary border-l-[3px] border-l-transparent',
        // 合并发起方：减淡 + 描边提示
        isMergeSource
          ? `opacity-50 ring-2 ring-inset ${CONFLICT_RING[conflictType]}`
          : '',
        // 合并等待模式下非发起方：绿色 hover 提示可点
        isMergeMode && !isMergeSource
          ? 'hover:bg-green-50 cursor-pointer'
          : 'hover:bg-surface-secondary',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        {/* 左：冲突标签 + 描述 + 日期 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${CONFLICT_BADGE[conflictType]}`}>
              {CONFLICT_LABEL[conflictType]}
            </span>
            <span className="text-xs font-semibold text-content-primary truncate">
              {tx.category}
            </span>
          </div>
          <p className="text-sm text-content-secondary truncate leading-snug">
            {tx.description || '（无描述）'}
          </p>
          <p className="text-[11px] text-content-tertiary mt-0.5">{tx.date}</p>
        </div>

        {/* 右：金额 + 合并提示 */}
        <div className="flex-shrink-0 text-right">
          <p className={[
            'text-sm font-bold tabular-nums',
            isExpense ? 'text-red-500' : 'text-green-600',
          ].join(' ')}>
            {formatAmount(tx.amount)}
          </p>
          {/* 合并等待模式提示文字 */}
          {isMergeMode && !isMergeSource && (
            <p className="text-[10px] text-green-600 mt-0.5 font-medium whitespace-nowrap">
              点击设为目标
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════
// § 5  子组件：冲突详情面板
// ════════════════════════════════════════════════════════════════

interface DetailPaneProps {
  item:          ConflictItem
  isProcessing:  boolean
  errorMsg:      string | null
  /** 合并模式下非 null（发起方 ID），详情面板显示合并等待 UI */
  mergeSourceId: string | null
  onForceAdd:    () => void
  onArchive:     () => void
  onMergeStart:  () => void
  onMergeCancel: () => void
}

function ConflictDetailPane({
  item, isProcessing, errorMsg,
  mergeSourceId,
  onForceAdd, onArchive, onMergeStart, onMergeCancel,
}: DetailPaneProps) {
  const { tx, conflictType } = item
  const isMergeMode = mergeSourceId !== null

  // 从 rawData 中提取迁移元数据
  const contentHash  = tx.rawData['_contentHash']    as string  | undefined
  const isMigrated   = tx.rawData['_migratedFromV2'] as boolean | undefined

  // 账单核心字段展示列表
  const fields: [string, string][] = [
    ['日期',     tx.date],
    ['分类',     tx.category],
    ['描述',     tx.description || '（无）'],
    ['金额',     formatAmount(tx.amount)],
    ['状态',     tx.status],
    ['来源',     tx.source],
    ['录入方式', tx.sourceType],
  ]

  return (
    <div className="bg-surface-secondary border-t-2 border-primary-200 px-4 pt-4 pb-5">

      {/* ── 账单基本信息 ── */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CONFLICT_BADGE[conflictType]}`}>
            {CONFLICT_LABEL[conflictType]}
          </span>
          <span className="text-[10px] text-content-tertiary font-mono">
            ID: {tx.id.slice(0, 12)}…
          </span>
        </div>

        <dl className="space-y-1.5 text-xs">
          {fields.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-content-tertiary">{label}</dt>
              <dd className="text-content-primary font-medium flex-1 break-all">{value}</dd>
            </div>
          ))}
          {isMigrated && (
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-content-tertiary">迁移源</dt>
              <dd className="text-blue-600 font-semibold">V2 历史迁移</dd>
            </div>
          )}
          {contentHash && (
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-content-tertiary">内容哈希</dt>
              <dd className="text-content-tertiary font-mono text-[10px] break-all">{contentHash}</dd>
            </div>
          )}
          {tx.tags.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-16 flex-shrink-0 text-content-tertiary">标签</dt>
              <dd className="flex flex-wrap gap-1">
                {tx.tags.map(tag => (
                  <span key={tag}
                    className="px-1.5 py-0.5 bg-surface-tertiary rounded text-[10px] text-content-secondary">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* ── 错误提示 ── */}
      {errorMsg && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
          <span className="text-sm mt-0.5">⚠️</span>
          <p className="text-xs text-red-600 flex-1">{errorMsg}</p>
        </div>
      )}

      {/* ── 操作按钮区 ── */}
      {isMergeMode ? (
        // ─── 合并等待模式 ────────────────────────────────────────
        <div className="space-y-2.5">
          <div className="px-3 py-2.5 bg-primary-50 border border-primary-200 rounded-xl flex items-center gap-2">
            <span className="text-base">🔗</span>
            <p className="text-xs text-primary-700 font-medium flex-1">
              合并模式已激活 — 请在列表中点击另一条账单作为合并目标
            </p>
          </div>
          <button
            onClick={onMergeCancel}
            className={[
              'w-full py-2.5 rounded-xl text-sm font-medium transition-colors',
              'bg-surface-primary border border-border-primary',
              'text-content-secondary hover:bg-surface-tertiary',
            ].join(' ')}
          >
            取消合并
          </button>
        </div>
      ) : (
        // ─── 正常操作模式 ────────────────────────────────────────
        <div className="space-y-2.5">

          {/* 强制入账：重复 / 待验证 类型可用 */}
          {(conflictType === 'duplicate' || conflictType === 'pending') && (
            <button
              onClick={onForceAdd}
              disabled={isProcessing}
              className={[
                'w-full py-2.5 rounded-xl text-sm font-semibold transition-colors',
                'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'flex items-center justify-center gap-2',
              ].join(' ')}
            >
              {isProcessing && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              ✅ 强制入账
            </button>
          )}

          {/* 合并：仅重复类型可用，需要用户再选一条目标账单 */}
          {conflictType === 'duplicate' && (
            <button
              onClick={onMergeStart}
              disabled={isProcessing}
              className={[
                'w-full py-2.5 rounded-xl text-sm font-semibold transition-colors',
                'border-2 border-primary-400 text-primary-600',
                'hover:bg-primary-50 active:bg-primary-100',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              🔗 合并到另一条
            </button>
          )}

          {/* 作废：所有类型均可使用 */}
          <button
            onClick={onArchive}
            disabled={isProcessing}
            className={[
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-colors',
              'border border-red-300 text-red-600',
              'hover:bg-red-50 active:bg-red-100',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            🗑 作废此账单
          </button>

        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 6  主组件：冲突与治理中心
// ════════════════════════════════════════════════════════════════

export default function ConflictCenter() {
  const { allLedgerBills, billsReady }      = useBills()
  const { user }                            = useAuthStore()
  const { selectedConflictId, selectConflict } = useGovernanceStore()

  // ── 本地 UI 状态 ────────────────────────────────────────────────
  const [filter,        setFilter]        = useState<ConflictFilter>('all')
  const [isProcessing,  setIsProcessing]  = useState(false)
  const [errorMsg,      setErrorMsg]      = useState<string | null>(null)
  const [successMsg,    setSuccessMsg]    = useState<string | null>(null)
  /**
   * mergeSourceId — 合并操作发起方账单 ID
   * null = 未进入合并模式
   * 非null = 等待用户点击第二条目标账单
   */
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null)

  // ── 冲突数据计算 ────────────────────────────────────────────────
  const conflicts = useMemo(
    () => detectConflicts(allLedgerBills),
    [allLedgerBills],
  )

  const filtered = useMemo(
    () => filter === 'all'
      ? conflicts
      : conflicts.filter(c => c.conflictType === filter),
    [conflicts, filter],
  )

  const counts = useMemo<Record<ConflictFilter, number>>(() => ({
    all:         conflicts.length,
    duplicate:   conflicts.filter(c => c.conflictType === 'duplicate').length,
    pending:     conflicts.filter(c => c.conflictType === 'pending').length,
    no_evidence: conflicts.filter(c => c.conflictType === 'no_evidence').length,
  }), [conflicts])

  const selectedItem = useMemo(
    () => filtered.find(c => c.tx.id === selectedConflictId) ?? null,
    [filtered, selectedConflictId],
  )

  // ── 工具：成功提示自动消失 ────────────────────────────────────
  function showSuccess(msg: string): void {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  // ── 处理卡片点击 ──────────────────────────────────────────────
  function handleCardClick(item: ConflictItem): void {
    if (mergeSourceId) {
      // 合并等待模式
      if (item.tx.id === mergeSourceId) {
        // 再次点击发起方 → 取消合并
        setMergeSourceId(null)
      } else {
        // 点击另一张卡 → 触发合并
        void handleMergeConfirm(item.tx.id)
      }
    } else {
      // 正常模式：toggle 选中
      selectConflict(selectedConflictId === item.tx.id ? null : item.tx.id)
      setErrorMsg(null)
    }
  }

  // ── 操作：强制入账 ────────────────────────────────────────────
  async function handleForceAdd(): Promise<void> {
    if (!selectedItem || !user) return
    setIsProcessing(true)
    setErrorMsg(null)
    try {
      await forceAdd(selectedItem.tx.id, user.uid)
      selectConflict(null)
      showSuccess('✅ 已强制入账')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── 操作：作废 ──────────────────────────────────────────────
  async function handleArchive(): Promise<void> {
    if (!selectedItem || !user) return
    const confirmed = window.confirm(
      `确认作废「${selectedItem.tx.description || selectedItem.tx.category}」` +
      `（${formatAmount(selectedItem.tx.amount)}）？\n\n此操作不可撤销，但可通过版本记录追溯。`
    )
    if (!confirmed) return
    setIsProcessing(true)
    setErrorMsg(null)
    try {
      await archiveTransaction(selectedItem.tx.id, user.uid)
      selectConflict(null)
      showSuccess('🗑 已作废')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── 操作：进入合并模式（等待用户选第二张目标卡）────────────────
  function handleMergeStart(): void {
    if (!selectedItem) return
    setMergeSourceId(selectedItem.tx.id)
    setErrorMsg(null)
  }

  // ── 操作：确认合并（用户选完第二张目标卡后触发）─────────────────
  async function handleMergeConfirm(targetId: string): Promise<void> {
    if (!mergeSourceId || !user) return
    setIsProcessing(true)
    setErrorMsg(null)
    try {
      await mergeTransactions(mergeSourceId, targetId, user.uid)
      setMergeSourceId(null)
      selectConflict(null)
      showSuccess('🔗 合并完成')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '合并失败，请重试')
      setMergeSourceId(null)
    } finally {
      setIsProcessing(false)
    }
  }

  // ── 筛选条变更处理（同时重置所有活动状态）──────────────────────
  function handleFilterChange(f: ConflictFilter): void {
    setFilter(f)
    selectConflict(null)
    setMergeSourceId(null)
    setErrorMsg(null)
  }

  // ── 骨架屏 ────────────────────────────────────────────────────
  if (!billsReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        <p className="text-sm text-content-tertiary">账单数据加载中…</p>
      </div>
    )
  }

  // ── 主界面渲染 ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full bg-surface-primary">

      {/* ═══ 页头区域 ═══ */}
      <div className="px-4 pt-5 pb-3 bg-surface-primary">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-content-primary tracking-tight">
              🛡️ 冲突与治理中心
            </h1>
            <p className="text-xs text-content-tertiary mt-0.5">
              {conflicts.length > 0
                ? `共发现 ${conflicts.length} 条数据质量问题待处理`
                : '数据质量良好，暂无冲突记录'
              }
            </p>
          </div>
          {/* 总冲突数红点徽章 */}
          {conflicts.length > 0 && (
            <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500 text-white text-sm font-bold shadow">
              {conflicts.length > 99 ? '99+' : conflicts.length}
            </span>
          )}
        </div>
      </div>

      {/* ═══ 成功提示条（操作完成后 3 秒消失）═══ */}
      {successMsg && (
        <div className="mx-4 mb-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-xs text-green-700 font-semibold">{successMsg}</p>
        </div>
      )}

      {/* ═══ 合并模式全局横幅 ═══ */}
      {mergeSourceId && (
        <div className="mx-4 mb-2 px-3 py-2.5 bg-primary-50 border border-primary-300 rounded-xl flex items-center gap-2">
          <span className="text-base">🔗</span>
          <p className="text-xs text-primary-700 font-semibold flex-1">
            合并模式已激活 — 请在列表中选择另一条账单作为合并目标
          </p>
          <button
            onClick={() => setMergeSourceId(null)}
            className="text-xs text-primary-500 hover:text-primary-700 font-medium"
          >
            取消
          </button>
        </div>
      )}

      {/* ═══ 筛选条 ═══ */}
      <ConflictFilterBar
        filter={filter}
        counts={counts}
        onChange={handleFilterChange}
      />

      {/* ═══ 冲突列表（含内联详情面板）═══ */}
      <div className="flex-1">
        {filtered.length === 0 ? (
          // ─── 空状态 ────────────────────────────────────────────
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3 px-8">
            <span className="text-5xl">
              {filter === 'all' ? '🎉' : '✨'}
            </span>
            <p className="text-base font-semibold text-content-primary">
              {filter === 'all'
                ? '账套数据质量优秀，暂无冲突'
                : `无"${CONFLICT_LABEL[filter as ConflictType]}"类冲突`}
            </p>
            <p className="text-xs text-content-tertiary leading-relaxed">
              {filter === 'all'
                ? '当前账套内所有账单均已核实，数据干净可信'
                : '切换其他筛选器查看不同类型的冲突记录'}
            </p>
          </div>
        ) : (
          // ─── 冲突卡片列表 ────────────────────────────────────
          <div>
            {filtered.map((item) => (
              <div key={item.tx.id}>
                {/* 冲突卡片 */}
                <ConflictCard
                  item={item}
                  isSelected={selectedConflictId === item.tx.id}
                  isMergeSource={mergeSourceId === item.tx.id}
                  isMergeMode={mergeSourceId !== null}
                  onClick={() => handleCardClick(item)}
                />

                {/* 详情面板：紧接在选中卡片下方内联展开 */}
                {selectedConflictId === item.tx.id && selectedItem !== null && (
                  <ConflictDetailPane
                    item={selectedItem}
                    isProcessing={isProcessing}
                    errorMsg={errorMsg}
                    mergeSourceId={mergeSourceId}
                    onForceAdd={() => { void handleForceAdd() }}
                    onArchive={() => { void handleArchive() }}
                    onMergeStart={handleMergeStart}
                    onMergeCancel={() => setMergeSourceId(null)}
                  />
                )}
              </div>
            ))}

            {/* 列表底部留白（避免被 BottomNav 遮挡）*/}
            <div className="h-6" />
          </div>
        )}
      </div>
    </div>
  )
}
