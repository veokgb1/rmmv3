// DataManagementCenter — V3 数据管理中心 UI
//
// 位置：设置页 → 数据管理板块 → 导入 V2 历史数据 正下方
//
// 功能模块：
//   📦 备份管理    — 4 种类型 × 3 槽位 FIFO 滚动存储，每种独立触发
//   🗑️ 精准删除   — 5 个模块勾选矩阵 + "确认销毁"四字解锁 + 物理抹除
//   🔬 交叉审计占位 — Beta 视觉占位，指向未来功能
//
// 视觉约定：
//   · 所有条件色通过 inline style（绕过 PurgeCSS）
//   · 删除区域默认折叠，需主动展开（安全护栏）

import { useState, useEffect, useCallback } from 'react'
import { useLedgerStore }                   from '@/store/ledgerStore'
import {
  BACKUP_TYPE_META,
  DELETE_MODULE_META,
  loadAllBackupSlots,
  createBackup,
  deleteBackupSlot,
  restoreFromBackup,
  fetchDeleteCounts,
  executeDelete,
  formatSize,
  type BackupType,
  type BackupSlot,
  type DeleteModule,
} from '@/services/firebase/backupService'

// ════════════════════════════════════════════════════════════════
// Props
// ════════════════════════════════════════════════════════════════

interface DataManagementCenterProps {
  ledgerId:   string
  showToast?: (msg: string, type?: 'success' | 'warning' | 'error') => void
}

const BACKUP_TYPES: BackupType[]   = ['full', 'conflict', 'poolA', 'poolB']
const DELETE_MODULES: DeleteModule[] = ['manual', 'v2import', 'evidenceOk', 'poolA', 'poolB']
const CONFIRM_KEYWORD = '确认销毁'

// ════════════════════════════════════════════════════════════════
// 子组件：单个槽位徽章
//   · 空槽    — 灰色虚线框，无交互
//   · 已填槽  — 绿色框，右上角 × 按钮
//   · 确认态  — 点击 × 后，内联变形为二次确认视图
// ════════════════════════════════════════════════════════════════

interface SlotBadgeProps {
  slot?:             BackupSlot
  empty?:            boolean
  isConfirming?:     boolean   // 是否处于删除二次确认态
  isDeleting?:       boolean   // 是否正在执行删除
  onDeleteRequest?:  () => void  // 点击 × 触发
  onRestoreRequest?: () => void  // 点击 ↺ 触发
  onConfirm?:        () => void  // 点击"确认删除"触发
  onCancel?:         () => void  // 点击"取消"触发
}

function SlotBadge({
  slot, empty, isConfirming, isDeleting,
  onDeleteRequest, onRestoreRequest, onConfirm, onCancel,
}: SlotBadgeProps) {

  // ── 空槽 ──────────────────────────────────────────────────────
  if (empty || !slot) {
    return (
      <div
        className="flex-1 min-w-0 rounded-xl px-2 py-1.5 text-center"
        style={{ background: '#f8fafc', border: '1.5px dashed #cbd5e1' }}
      >
        <p style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600 }}>空槽</p>
        <p style={{ fontSize: 9, color: '#cbd5e1' }}>—</p>
      </div>
    )
  }

  // ── 二次确认态 ────────────────────────────────────────────────
  if (isConfirming) {
    return (
      <div
        className="flex-1 min-w-0 rounded-xl px-2 py-1.5 flex flex-col items-center justify-center gap-1"
        style={{ background: '#fff1f2', border: '1.5px solid #fca5a5' }}
      >
        <p style={{ fontSize: 9, color: '#be123c', fontWeight: 700, lineHeight: 1.3 }}>
          确认删除？
        </p>
        <div className="flex gap-1 w-full">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 rounded-lg transition-colors"
            style={{
              fontSize: 8, fontWeight: 700, padding: '2px 0',
              background: '#f1f5f9', color: '#64748b',
              border: '1px solid #e2e8f0',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 rounded-lg transition-colors"
            style={{
              fontSize: 8, fontWeight: 700, padding: '2px 0',
              background: isDeleting ? '#fca5a5' : '#e11d48',
              color: '#fff',
              border: '1px solid #f43f5e',
            }}
          >
            {isDeleting ? '…' : '删除'}
          </button>
        </div>
      </div>
    )
  }

  // ── 已填槽（正常态） ──────────────────────────────────────────
  return (
    <div
      className="relative flex-1 min-w-0 rounded-xl px-2 text-center"
      style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', paddingTop: 18, paddingBottom: 6 }}
    >
      {/* ↺ 恢复按钮（左上角） */}
      <button
        onClick={e => { e.stopPropagation(); onRestoreRequest?.() }}
        className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full
                   flex items-center justify-center transition-colors
                   hover:scale-110 active:scale-95"
        style={{ background: '#bfdbfe', color: '#1d4ed8', fontSize: 8, fontWeight: 900 }}
        title="从此备份恢复"
      >
        ↺
      </button>

      {/* × 删除按钮（右上角） */}
      <button
        onClick={e => { e.stopPropagation(); onDeleteRequest?.() }}
        className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full
                   flex items-center justify-center transition-colors
                   hover:scale-110 active:scale-95"
        style={{ background: '#fca5a5', color: '#be123c', fontSize: 8, fontWeight: 900 }}
        title="删除此备份"
      >
        ×
      </button>

      <p className="truncate px-3" style={{ fontSize: 9, color: '#16a34a', fontWeight: 700 }}>
        {slot.label.slice(5)}
      </p>
      <p style={{ fontSize: 9, color: '#4ade80' }}>
        {slot.counts.transactions > 0 ? `${slot.counts.transactions}笔` : ''}
        {slot.counts.evidences > 0
          ? `${slot.counts.transactions > 0 ? '+' : ''}${slot.counts.evidences}证`
          : ''}
        {slot.counts.transactions === 0 && slot.counts.evidences === 0 ? '—' : ''}
      </p>
      <p style={{ fontSize: 8, color: '#86efac' }}>{formatSize(slot.sizeByte)}</p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// 子组件：恢复确认弹窗
// ════════════════════════════════════════════════════════════════

interface LedgerInfo { id: string; name: string }

interface RestoreModalProps {
  slot:           BackupSlot
  backupType:     BackupType
  ledgers:        LedgerInfo[]
  sourceLedgerId: string
  isRestoring:    boolean
  restoreProgress: string
  onConfirm:      (targetLedgerId: string) => void
  onClose:        () => void
}

function RestoreModal({
  slot, backupType, ledgers, sourceLedgerId,
  isRestoring, restoreProgress, onConfirm, onClose,
}: RestoreModalProps) {
  const meta = BACKUP_TYPE_META[backupType]
  const [targetId, setTargetId] = useState(sourceLedgerId)
  const isCrossLedger = targetId !== sourceLedgerId

  return (
    <div
      className="fixed inset-0 z-[700] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget && !isRestoring) onClose() }}
    >
      <div
        className="w-full sm:max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#fff', border: '1.5px solid #e2e8f0' }}
      >
        {/* 标题栏 */}
        <div
          className="px-5 py-4 flex items-center gap-3"
          style={{ background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}
        >
          <span className="text-xl">↺</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800">恢复备份</p>
            <p className="text-xs text-slate-500 truncate">{meta.icon} {meta.label}</p>
          </div>
          {!isRestoring && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400
                         hover:bg-slate-100 transition-colors"
              style={{ fontSize: 16 }}
            >
              ×
            </button>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* 备份摘要 */}
          <div
            className="rounded-xl px-3 py-2.5 space-y-1"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
          >
            <p className="text-[11px] font-bold text-slate-600">备份内容</p>
            <p className="text-xs text-slate-700 font-semibold">{slot.label}</p>
            <p className="text-[11px] text-slate-500">
              {slot.counts.transactions} 笔交易 · {slot.counts.evidences} 条凭证 · {formatSize(slot.sizeByte)}
            </p>
            <p className="text-[11px] text-slate-400">
              创建于 {new Date(slot.createdAt).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>

          {/* 目标账套选择 */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-600">写入目标账套</p>
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              disabled={isRestoring}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all
                         appearance-none cursor-pointer"
              style={{
                background: '#f8fafc',
                border:     '1.5px solid #e2e8f0',
                color:      '#334155',
              }}
            >
              {ledgers.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* 跨账套警告 */}
          {isCrossLedger && (
            <div
              className="rounded-xl px-3 py-2 flex items-start gap-2"
              style={{ background: '#fffbeb', border: '1.5px solid #fde68a' }}
            >
              <span className="flex-shrink-0">⚠️</span>
              <p className="text-[11px] leading-relaxed" style={{ color: '#92400e' }}>
                目标账套与备份来源不同，所有记录的 <code>ledgerId</code> 字段将被重写为目标账套 ID。
              </p>
            </div>
          )}

          {/* 覆盖警告 */}
          <div
            className="rounded-xl px-3 py-2 flex items-start gap-2"
            style={{ background: '#fff1f2', border: '1.5px solid #fecdd3' }}
          >
            <span className="flex-shrink-0">🔴</span>
            <p className="text-[11px] leading-relaxed" style={{ color: '#be123c' }}>
              此操作将以 <strong>Upsert（覆盖合并）</strong>方式写入正式库——
              相同 ID 的记录将被覆盖，新 ID 的记录将被追加。建议先执行备份再恢复。
            </p>
          </div>

          {/* 恢复进度 */}
          {isRestoring && restoreProgress && (
            <p className="text-[11px] font-medium" style={{ color: '#1d4ed8' }}>
              ⏳ {restoreProgress}
            </p>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={isRestoring}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: '#f1f5f9', color: '#64748b', border: '1.5px solid #e2e8f0' }}
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(targetId)}
              disabled={isRestoring}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                         flex items-center justify-center gap-1.5 disabled:opacity-70"
              style={{ background: '#1d4ed8', color: '#fff', boxShadow: '0 4px 12px rgba(29,78,216,0.35)' }}
            >
              {isRestoring ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>恢复中…</span>
                </>
              ) : (
                <>
                  <span>↺</span>
                  <span>确认恢复</span>
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════

export default function DataManagementCenter({ ledgerId, showToast }: DataManagementCenterProps) {

  // ── 账套列表（目标选择器用）────────────────────────────────────
  const ledgers = useLedgerStore(s => s.ledgers)

  // ── 备份管理状态 ──────────────────────────────────────────────
  const [slotsMap,       setSlotsMap]       = useState<Record<BackupType, BackupSlot[]>>({
    full: [], conflict: [], poolA: [], poolB: [],
  })
  const [loadingSlots,   setLoadingSlots]   = useState(true)
  const [backingUpType,  setBackingUpType]  = useState<BackupType | null>(null)
  const [backupProgress, setBackupProgress] = useState('')

  // ── 槽位手动删除状态 ──────────────────────────────────────────
  // confirmingSlot: 当前处于二次确认态的槽位（null = 无）
  const [confirmingSlot,  setConfirmingSlot]  = useState<{ type: BackupType; index: 0|1|2 } | null>(null)
  const [isDeletingSlot,  setIsDeletingSlot]  = useState(false)

  // ── 恢复状态 ──────────────────────────────────────────────────
  const [restoringSlot,   setRestoringSlot]   = useState<{ type: BackupType; slot: BackupSlot } | null>(null)
  const [isRestoring,     setIsRestoring]     = useState(false)
  const [restoreProgress, setRestoreProgress] = useState('')

  // ── 精准删除状态（默认折叠）────────────────────────────────────
  const [showDelete,      setShowDelete]      = useState(false)
  const [loadingCounts,   setLoadingCounts]   = useState(false)
  const [deleteCounts,    setDeleteCounts]    = useState<Record<DeleteModule, number> | null>(null)
  const [selectedModules, setSelectedModules] = useState<Set<DeleteModule>>(new Set())
  const [confirmInput,    setConfirmInput]    = useState('')
  const [isDeleting,      setIsDeleting]      = useState(false)
  const [deleteProgress,  setDeleteProgress]  = useState('')
  const [deleteResult,    setDeleteResult]    = useState<number | null>(null)

  // ── 初始加载：读取 4 种备份类型的槽位元数据 ────────────────────
  const reloadSlots = useCallback(async () => {
    if (!ledgerId) return
    setLoadingSlots(true)
    try {
      const map = await loadAllBackupSlots(ledgerId)
      setSlotsMap(map)
    } catch (err) {
      console.error('[DataMgmt] 加载备份槽位失败:', err)
      showToast?.('加载备份信息失败', 'error')
    } finally {
      setLoadingSlots(false)
    }
  }, [ledgerId, showToast])

  useEffect(() => { void reloadSlots() }, [reloadSlots])

  // ── 展开删除区时加载记录数 ─────────────────────────────────────
  useEffect(() => {
    if (!showDelete || deleteCounts !== null || loadingCounts) return
    void (async () => {
      setLoadingCounts(true)
      try {
        const counts = await fetchDeleteCounts(ledgerId)
        setDeleteCounts(counts)
      } catch {
        showToast?.('加载记录数失败', 'error')
      } finally {
        setLoadingCounts(false)
      }
    })()
  }, [showDelete, ledgerId, deleteCounts, loadingCounts, showToast])

  // ── 确认删除单个槽位 ──────────────────────────────────────────
  async function handleConfirmSlotDelete() {
    if (!confirmingSlot) return
    const { type, index } = confirmingSlot
    setIsDeletingSlot(true)
    try {
      await deleteBackupSlot(ledgerId, type, index)
      showToast?.(`🗑️ 已删除 ${BACKUP_TYPE_META[type].label} 槽位 ${index + 1}`, 'success')
      setConfirmingSlot(null)
      // 即时刷新：从本地 slotsMap 中移除该槽位，无需等待网络重新加载
      setSlotsMap(prev => ({
        ...prev,
        [type]: prev[type].filter(s => s.index !== index),
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败'
      showToast?.(msg, 'error')
      setConfirmingSlot(null)
    } finally {
      setIsDeletingSlot(false)
    }
  }

  // ── 立即备份 ──────────────────────────────────────────────────
  async function handleBackup(type: BackupType) {
    if (backingUpType !== null) return
    setBackingUpType(type)
    setBackupProgress('')
    try {
      const slot = await createBackup(ledgerId, type, msg => setBackupProgress(msg))
      showToast?.(
        `✅ ${BACKUP_TYPE_META[type].label} 完成（${slot.counts.transactions}笔 / ${slot.counts.evidences}证）`,
        'success',
      )
      await reloadSlots()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '备份失败'
      showToast?.(msg, 'error')
    } finally {
      setBackingUpType(null)
      setBackupProgress('')
    }
  }

  // ── 执行恢复 ──────────────────────────────────────────────────
  async function handleRestoreConfirm(targetLedgerId: string) {
    if (!restoringSlot || isRestoring) return
    const { type, slot } = restoringSlot
    setIsRestoring(true)
    setRestoreProgress('')
    try {
      const result = await restoreFromBackup(
        ledgerId, type, slot.index, targetLedgerId,
        msg => setRestoreProgress(msg),
      )
      showToast?.(
        `✅ 已恢复 ${result.transactions} 笔交易 / ${result.evidences} 条凭证 至目标账套`,
        'success',
      )
      setRestoringSlot(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '恢复失败'
      showToast?.(msg, 'error')
    } finally {
      setIsRestoring(false)
      setRestoreProgress('')
    }
  }

  // ── 删除模块勾选 ──────────────────────────────────────────────
  function toggleModule(mod: DeleteModule) {
    setSelectedModules(prev => {
      const next = new Set(prev)
      next.has(mod) ? next.delete(mod) : next.add(mod)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedModules(prev =>
      prev.size === DELETE_MODULES.length
        ? new Set()
        : new Set(DELETE_MODULES)
    )
  }

  // ── 执行删除 ──────────────────────────────────────────────────
  async function handleDelete() {
    if (confirmInput !== CONFIRM_KEYWORD) return
    if (selectedModules.size === 0) { showToast?.('请至少勾选一个模块', 'warning'); return }
    setIsDeleting(true)
    setDeleteProgress('')
    setDeleteResult(null)
    try {
      const count = await executeDelete(
        ledgerId,
        Array.from(selectedModules),
        msg => setDeleteProgress(msg),
      )
      setDeleteResult(count)
      showToast?.(`✅ 已彻底销毁 ${count} 条记录`, 'success')
      // 重置删除区状态
      setConfirmInput('')
      setSelectedModules(new Set())
      setDeleteCounts(null)   // 强制刷新计数
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败'
      showToast?.(msg, 'error')
    } finally {
      setIsDeleting(false)
      setDeleteProgress('')
    }
  }

  // ── 解锁条件 ──────────────────────────────────────────────────
  const isDeleteUnlocked =
    confirmInput === CONFIRM_KEYWORD && selectedModules.size > 0 && !isDeleting

  // ════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════

  return (
    <div className="mt-3 space-y-3">

      {/* ── 标题行 ── */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-base">🛡️</span>
        <p className="text-xs font-bold text-slate-700">V3 数据管理中心</p>
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: '#dbeafe', color: '#1d4ed8' }}
        >
          BETA
        </span>
      </div>

      {/* ════════════════════════════════════════════════════════════
           §A  备份管理
      ════════════════════════════════════════════════════════════ */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1.5px solid #e2e8f0', background: '#ffffff' }}
      >
        {/* 区块标题 */}
        <div
          className="px-4 py-3 flex items-center gap-2"
          style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}
        >
          <span>📦</span>
          <p className="text-xs font-bold text-slate-700 flex-1">备份管理</p>
          <p className="text-[10px] text-slate-400">3+3+3+3 FIFO 架构</p>
        </div>

        {loadingSlots ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <div className="w-4 h-4 rounded-full border-2 border-primary-300 border-t-primary-500 animate-spin" />
            <p className="text-xs text-slate-400">加载备份槽位…</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#f1f5f9' }}>
            {BACKUP_TYPES.map(type => {
              const meta    = BACKUP_TYPE_META[type]
              const slots   = slotsMap[type]
              const isBusy  = backingUpType === type
              const anyBusy = backingUpType !== null

              // 将已有槽位按 index 映射到 3 个位置
              const slotsByIndex: (BackupSlot | undefined)[] = [
                slots.find(s => s.index === 0),
                slots.find(s => s.index === 1),
                slots.find(s => s.index === 2),
              ]

              return (
                <div key={type} className="px-4 py-3 space-y-2">

                  {/* 类型标题行 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700">{meta.label}</p>
                      <p className="text-[10px] text-slate-400 truncate">{meta.desc}</p>
                    </div>
                    <button
                      onClick={() => void handleBackup(type)}
                      disabled={anyBusy}
                      className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold
                                 transition-all active:scale-95"
                      style={isBusy
                        ? { background: '#fef3c7', color: '#d97706', border: '1.5px solid #fde68a' }
                        : anyBusy
                          ? { background: '#f1f5f9', color: '#94a3b8', border: '1.5px solid #e2e8f0', cursor: 'not-allowed' }
                          : { background: '#dbeafe', color: '#1d4ed8', border: '1.5px solid #bfdbfe' }
                      }
                    >
                      {isBusy ? (
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          备份中
                        </span>
                      ) : '立即备份'}
                    </button>
                  </div>

                  {/* 进度文字（备份中显示） */}
                  {isBusy && backupProgress && (
                    <p className="text-[10px] text-amber-600 px-1">{backupProgress}</p>
                  )}

                  {/* 3 槽位徽章 */}
                  <div className="flex gap-1.5">
                    {slotsByIndex.map((slot, i) => {
                      const idx         = i as 0 | 1 | 2
                      const isThisConfirming =
                        confirmingSlot?.type === type && confirmingSlot?.index === idx
                      return (
                        <SlotBadge
                          key={i}
                          slot={slot}
                          empty={!slot}
                          isConfirming={isThisConfirming}
                          isDeleting={isDeletingSlot && isThisConfirming}
                          onDeleteRequest={() => setConfirmingSlot({ type, index: idx })}
                          onRestoreRequest={slot ? () => setRestoringSlot({ type, slot }) : undefined}
                          onConfirm={() => void handleConfirmSlotDelete()}
                          onCancel={() => setConfirmingSlot(null)}
                        />
                      )
                    })}
                  </div>

                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
           §B  精准删除（默认折叠）
      ════════════════════════════════════════════════════════════ */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1.5px solid #fecdd3', background: '#ffffff' }}
      >
        {/* 折叠标题行 */}
        <button
          onClick={() => setShowDelete(v => !v)}
          className="w-full px-4 py-3 flex items-center gap-2 text-left transition-colors hover:bg-red-50"
          style={{ borderBottom: showDelete ? '1px solid #fecdd3' : 'none' }}
        >
          <span>🗑️</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold" style={{ color: '#be123c' }}>精准删除</p>
            <p className="text-[10px] text-slate-400">物理抹除 Firestore 记录 + Storage 文件，不可撤销</p>
          </div>
          <span
            className="text-slate-400 text-xs transition-transform duration-200"
            style={{ transform: showDelete ? 'rotate(90deg)' : 'none' }}
          >›</span>
        </button>

        {showDelete && (
          <div className="px-4 py-4 space-y-4">

            {/* 警告横幅 */}
            <div
              className="rounded-xl px-3 py-2.5 flex items-start gap-2"
              style={{ background: '#fff1f2', border: '1.5px solid #fecdd3' }}
            >
              <span className="text-base flex-shrink-0">⚠️</span>
              <p className="text-[11px] leading-relaxed" style={{ color: '#be123c' }}>
                以下操作将<strong>永久删除</strong>选中数据，且同步清除 Firebase Storage 中对应的图片文件。
                建议先执行备份后再操作。
              </p>
            </div>

            {/* 模块勾选矩阵 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-600">选择要删除的模块</p>
                <button
                  onClick={toggleSelectAll}
                  className="text-[10px] font-semibold"
                  style={{ color: '#6366f1' }}
                >
                  {selectedModules.size === DELETE_MODULES.length ? '取消全选' : '全选'}
                </button>
              </div>

              {loadingCounts ? (
                <div className="flex items-center gap-2 py-3">
                  <div className="w-3 h-3 rounded-full border-2 border-rose-300 border-t-rose-500 animate-spin" />
                  <p className="text-[10px] text-slate-400">读取记录数…</p>
                </div>
              ) : (
                DELETE_MODULES.map(mod => {
                  const meta     = DELETE_MODULE_META[mod]
                  const count    = deleteCounts?.[mod] ?? 0
                  const selected = selectedModules.has(mod)

                  return (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => toggleModule(mod)}
                      disabled={isDeleting}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                                 text-left transition-all active:scale-[0.99]"
                      style={selected
                        ? { background: '#fff1f2', border: '1.5px solid #fecdd3' }
                        : { background: '#f8fafc', border: '1.5px solid #e2e8f0', opacity: 0.6 }
                      }
                    >
                      {/* 复选框 */}
                      <div
                        className="w-4.5 h-4.5 rounded-md border-2 flex-shrink-0
                                   flex items-center justify-center"
                        style={selected
                          ? { borderColor: '#e11d48', background: '#e11d48' }
                          : { borderColor: '#cbd5e1', background: '#fff' }
                        }
                      >
                        {selected && (
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>

                      <span className="text-base flex-shrink-0">{meta.icon}</span>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-700">{meta.label}</p>
                        {meta.hasStorage && (
                          <p className="text-[9px]" style={{ color: '#f43f5e' }}>含 Storage 图片文件</p>
                        )}
                      </div>

                      {/* 记录数徽章 */}
                      <span
                        className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums"
                        style={count > 0
                          ? { background: '#ffe4e6', color: '#be123c' }
                          : { background: '#f1f5f9', color: '#94a3b8' }
                        }
                      >
                        {count > 0 ? `${count} 条` : '空'}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            {/* 确认销毁输入框 */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-slate-600">
                输入 <span style={{ color: '#e11d48', fontFamily: 'monospace' }}>确认销毁</span> 解锁删除按钮
              </p>
              <input
                type="text"
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder="请输入：确认销毁"
                disabled={isDeleting}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{
                  background:  confirmInput === CONFIRM_KEYWORD ? '#fff1f2' : '#f8fafc',
                  border:      `1.5px solid ${confirmInput === CONFIRM_KEYWORD ? '#fca5a5' : '#e2e8f0'}`,
                  color:       confirmInput === CONFIRM_KEYWORD ? '#be123c' : '#334155',
                  fontWeight:  confirmInput === CONFIRM_KEYWORD ? 700 : 400,
                }}
              />
            </div>

            {/* 删除进度 */}
            {isDeleting && deleteProgress && (
              <p className="text-[11px] font-medium" style={{ color: '#e11d48' }}>
                ⏳ {deleteProgress}
              </p>
            )}

            {/* 删除结果 */}
            {deleteResult !== null && !isDeleting && (
              <div
                className="rounded-xl px-3 py-2 flex items-center gap-2"
                style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0' }}
              >
                <span>✅</span>
                <p className="text-xs font-semibold" style={{ color: '#16a34a' }}>
                  已彻底销毁 {deleteResult} 条记录
                </p>
              </div>
            )}

            {/* 执行按钮 */}
            <button
              onClick={() => void handleDelete()}
              disabled={!isDeleteUnlocked}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all
                         flex items-center justify-center gap-2"
              style={isDeleteUnlocked
                ? { background: '#e11d48', color: '#fff', boxShadow: '0 4px 14px rgba(225,29,72,0.35)' }
                : { background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed' }
              }
            >
              {isDeleting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>销毁中…</span>
                </>
              ) : (
                <>
                  <span>💣</span>
                  <span>
                    {isDeleteUnlocked
                      ? `执行物理销毁（${selectedModules.size} 模块）`
                      : '请勾选模块并输入确认词'}
                  </span>
                </>
              )}
            </button>

          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
           §C  数据交叉审计占位（Beta）
      ════════════════════════════════════════════════════════════ */}
      {/* ── 恢复确认弹窗 ── */}
      {restoringSlot && (
        <RestoreModal
          slot={restoringSlot.slot}
          backupType={restoringSlot.type}
          ledgers={ledgers.map(l => ({ id: l.id, name: l.name }))}
          sourceLedgerId={ledgerId}
          isRestoring={isRestoring}
          restoreProgress={restoreProgress}
          onConfirm={targetLedgerId => void handleRestoreConfirm(targetLedgerId)}
          onClose={() => { if (!isRestoring) setRestoringSlot(null) }}
        />
      )}
      <div
        className="rounded-2xl px-4 py-3.5 flex items-start gap-3"
        style={{
          border:     '1.5px dashed #cbd5e1',
          background: '#f8fafc',
          opacity:    0.75,
        }}
      >
        <span className="text-lg flex-shrink-0 mt-0.5 grayscale">🔬</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-bold text-slate-500">数据交叉审计</p>
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#e2e8f0', color: '#64748b' }}
            >
              BETA · 开发中
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
            基于 3+3+3+3 架构进行重复项扫描——对比全量备份与 Pool A/B 子集备份中的 evidenceId 集合，高亮显示重复关联项。
          </p>
        </div>
        <span
          className="flex-shrink-0 text-[9px] font-bold px-2 py-1 rounded-full"
          style={{ background: '#e2e8f0', color: '#94a3b8' }}
        >
          即将推出
        </span>
      </div>

    </div>
  )
}
