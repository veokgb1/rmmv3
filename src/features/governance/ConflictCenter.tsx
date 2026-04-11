// 冲突与治理中心 — S21 核心 UI（补传凭证 + 无凭证强行入账 增强版）
//
// 数据流：billStore._allTransactions → detectConflicts() → 渲染列表
// 操作流：UI 触发 → governanceService → Firestore → onSnapshot → Store → UI 刷新
//
// 新增（本次修复）：
//   · no_evidence 类型操作区：【补传凭证】+【无凭证强行入账】
//   · detectConflicts 检测 rawData._noEvidenceConfirmed，已强行入账的不再列出

import { useState, useRef, useMemo, useEffect } from 'react'
import { StorageImage, ThumbnailImage }         from '@/components/ui/StorageImage'
import { useBills }                             from '@/hooks/useBills'
import { useAuthStore }               from '@/store/authStore'
import { useGovernanceStore }         from '@/store/governanceStore'
import {
  forceAdd,
  archiveTransaction,
  mergeTransactions,
  confirmNoEvidence,
  attachEvidenceUrl,
  batchForceAdd,
  batchConfirmNoEvidence,
} from '@/services/firebase/governanceService'
import { uploadEvidence, validateFile } from '@/services/firebase/evidenceService'
import { formatAmount }               from '@/utils/numberUtils'
import ReceiptPool                    from '@/features/governance/ReceiptPool'
import type { Transaction }           from '@/types/Transaction.types'

// ════════════════════════════════════════════════════════════════
// § 1  冲突类型定义
// ════════════════════════════════════════════════════════════════

/** 顶层视图切换：冲突列表 / 凭证管理池 */
type MainView = 'conflicts' | 'pool'

type ConflictType   = 'duplicate' | 'pending' | 'no_evidence'
type ConflictFilter = 'all' | ConflictType

interface ConflictItem {
  tx:           Transaction
  conflictType: ConflictType
}

const CONFLICT_LABEL: Record<ConflictType, string> = {
  duplicate:   '重复',
  pending:     '待验证',
  no_evidence: '缺凭证',
}

const CONFLICT_BADGE: Record<ConflictType, string> = {
  duplicate:   'bg-red-100 text-red-700',
  pending:     'bg-yellow-100 text-yellow-700',
  no_evidence: 'bg-blue-100 text-blue-700',
}

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
 *   1. isDuplicate === true                                → 重复
 *   2. V2迁移 + 未核实                                    → 待验证
 *   3. V2迁移 + 已核实 + 无 receiptUrls + 未强行入账      → 缺凭证
 *
 * 退出条件：
 *   · status === 'void'                        — 已作废，不参与检测
 *   · rawData._noEvidenceConfirmed === true    — 已通过"无凭证强行入账"处理
 */
function detectConflicts(bills: Transaction[]): ConflictItem[] {
  const result: ConflictItem[] = []

  for (const tx of bills) {
    if (tx.status === 'void') continue

    const isMigrated          = tx.rawData['_migratedFromV2']      === true
    const noEvidenceConfirmed = tx.rawData['_noEvidenceConfirmed'] === true

    if (tx.isDuplicate === true) {
      result.push({ tx, conflictType: 'duplicate' })
    } else if (isMigrated && tx.isVerified !== true) {
      result.push({ tx, conflictType: 'pending' })
    } else if (
      isMigrated &&
      tx.isVerified === true &&
      (!tx.receiptUrls || tx.receiptUrls.length === 0) &&
      !noEvidenceConfirmed   // 已强行入账的不再列出
    ) {
      result.push({ tx, conflictType: 'no_evidence' })
    }
  }

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
  isMergeSource: boolean
  isMergeMode:   boolean
  onClick:       () => void
}

function ConflictCard({
  item, isSelected, isMergeSource, isMergeMode, onClick,
}: ConflictCardProps) {
  const { tx, conflictType } = item
  const isExpense  = tx.amount < 0
  const receipts   = tx.receiptUrls ?? []
  const rawLegacy  = tx.rawData?.['legacy_backup'] as Record<string, unknown> | undefined
  const cardDesc   = (rawLegacy?.['summary'] as string | undefined) ||
                     (tx.description !== tx.category ? tx.description : '') ||
                     tx.description

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className={[
        'w-full text-left px-3 py-2 border-b border-border-primary',
        'transition-all duration-150 cursor-pointer',
        isSelected && !isMergeMode
          ? 'bg-primary-50 border-l-[3px] border-l-primary-500'
          : 'bg-surface-primary border-l-[3px] border-l-transparent',
        isMergeSource
          ? `opacity-50 ring-2 ring-inset ${CONFLICT_RING[conflictType]}`
          : '',
        isMergeMode && !isMergeSource
          ? 'hover:bg-green-50'
          : 'hover:bg-surface-secondary',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1 mb-0.5">
            <span className={`px-1 py-px rounded text-[9px] font-semibold flex-shrink-0 ${CONFLICT_BADGE[conflictType]}`}>
              {CONFLICT_LABEL[conflictType]}
            </span>
            <p className="text-[13px] font-semibold text-content-primary truncate leading-snug">
              {cardDesc || tx.category}
            </p>
          </div>
          <p className="text-[10px] text-content-tertiary truncate leading-none">
            {tx.category} · {tx.date}
          </p>
        </div>

        {/* ── 缩略图 36×36 ── */}
        <ThumbnailImage
          urls={receipts}
          sizeClass="w-9 h-9"
          onClick={e => e.stopPropagation()}
        />

        {/* ── 金额（收入蓝 / 支出红）── */}
        <div className="flex-shrink-0 text-right min-w-[52px]">
          <p className={[
            'text-sm font-bold tabular-nums',
            isExpense ? 'text-expense' : 'text-income',
          ].join(' ')}>
            {formatAmount(tx.amount)}
          </p>
          {isMergeMode && !isMergeSource && (
            <p className="text-[9px] text-green-600 mt-px font-medium whitespace-nowrap">
              点击设为目标
            </p>
          )}
        </div>

      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 5  子组件：冲突详情面板
// ════════════════════════════════════════════════════════════════

interface DetailPaneProps {
  item:                ConflictItem
  isProcessing:        boolean
  isUploading:         boolean
  uploadProgress:      number
  errorMsg:            string | null
  mergeSourceId:       string | null
  onForceAdd:          () => void
  onArchive:           () => void
  onMergeStart:        () => void
  onMergeCancel:       () => void
  onConfirmNoEvidence: () => void
  onAttachEvidence:    (file: File) => void
}

function ConflictDetailPane({
  item, isProcessing, isUploading, uploadProgress, errorMsg,
  mergeSourceId,
  onForceAdd, onArchive, onMergeStart, onMergeCancel,
  onConfirmNoEvidence, onAttachEvidence,
}: DetailPaneProps) {
  const { tx, conflictType } = item
  const isMergeMode = mergeSourceId !== null

  // 隐藏文件输入（补传凭证专用）
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lightbox 状态：null = 关闭，number = 当前查看的图片下标
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  // 右侧缩略图当前显示的图片下标（多图切换）
  const [photoIdx, setPhotoIdx]       = useState(0)

  const receipts    = tx.receiptUrls ?? []
  const contentHash = tx.rawData['_contentHash']    as string  | undefined
  const isMigrated  = tx.rawData['_migratedFromV2'] as boolean | undefined


  const migrationStatus    = tx.rawData['migrationStatus']    as string  | undefined
  const hasPhysicalVoucher = tx.rawData['hasPhysicalVoucher'] as boolean | undefined

  const detailLegacy = tx.rawData['legacy_backup'] as Record<string, unknown> | undefined
  const detailDesc =
    (detailLegacy?.['summary'] as string | undefined) ||
    (tx.description !== tx.category ? tx.description : '') ||
    tx.description

  const fields: [string, string][] = [
    ['日期', tx.date],
    ['分类', tx.category],
    ['描述', detailDesc || '（无）'],
    ...(tx.remark ? [['备注', tx.remark] as [string, string]] : []),
    ['金额', formatAmount(tx.amount)],
    ['来源', isMigrated ? 'V2 历史迁移' : tx.sourceType],
  ]

  return (
    <div className="bg-surface-secondary border-t-2 border-primary-200 px-4 pt-3 pb-4">

      {/* ── Lightbox 全屏模态框 ── */}
      {lightboxIdx !== null && receipts[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/85
                     backdrop-blur-sm"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-xl hover:bg-white/25
                       transition-colors z-10"
            onClick={() => setLightboxIdx(null)}
          >×</button>
          {receipts.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + receipts.length) % receipts.length) }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center
                           justify-center rounded-full bg-white/15 text-white text-lg
                           hover:bg-white/25 transition-colors z-10"
              >‹</button>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % receipts.length) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center
                           justify-center rounded-full bg-white/15 text-white text-lg
                           hover:bg-white/25 transition-colors z-10"
              >›</button>
            </>
          )}
          <StorageImage
            path={receipts[lightboxIdx]}
            alt={`凭证 ${lightboxIdx + 1}`}
            className="max-w-[92vw] max-h-[78vh] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <div
            className="absolute bottom-0 left-0 right-0 px-5 py-4
                       bg-gradient-to-t from-black/75 to-transparent
                       flex items-end justify-between"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <p className="text-white text-sm font-semibold leading-snug">{detailDesc || tx.category}</p>
              <p className="text-white/70 text-xs mt-0.5">{tx.date} · {tx.category}</p>
            </div>
            <div className="text-right">
              <p className={['text-base font-bold tabular-nums', tx.amount < 0 ? 'text-red-300' : 'text-green-300'].join(' ')}>
                {formatAmount(tx.amount)}
              </p>
              {receipts.length > 1 && (
                <p className="text-white/50 text-[11px]">{lightboxIdx + 1} / {receipts.length}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════ 主信息区：左文字 60% ＋ 右照片 40% ════ */}
      <div className="flex gap-3 mb-3">

        {/* ── 左侧：文字详情 ── */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${CONFLICT_BADGE[conflictType]}`}>
              {CONFLICT_LABEL[conflictType]}
            </span>
            <span className="text-[10px] text-content-tertiary font-mono truncate">
              {tx.id.slice(0, 10)}…
            </span>
          </div>

          <dl className="space-y-1 text-xs">
            {fields.map(([label, value]) => (
              <div key={label} className="flex gap-2 leading-tight">
                <dt className="w-10 flex-shrink-0 text-content-tertiary">{label}</dt>
                <dd className="text-content-primary font-medium flex-1 break-words">{value}</dd>
              </div>
            ))}
            {contentHash && (
              <div className="flex gap-2 leading-tight">
                <dt className="w-10 flex-shrink-0 text-content-tertiary">哈希</dt>
                <dd className="text-content-tertiary font-mono text-[10px] truncate">{contentHash.slice(0, 16)}…</dd>
              </div>
            )}
            {/* 迁移追踪标签（入账后显示，入账前为 undefined）*/}
            {migrationStatus && (
              <div className="flex gap-2 leading-tight items-center">
                <dt className="w-10 flex-shrink-0 text-content-tertiary">状态</dt>
                <dd>
                  <span className={[
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                    migrationStatus === 'V2_COMPLETE'
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      : 'bg-orange-50 text-orange-600 border-orange-200',
                  ].join(' ')}>
                    {migrationStatus === 'V2_COMPLETE' ? '✅ V2_COMPLETE' : '⚠️ V2_TEXT_ONLY'}
                  </span>
                </dd>
              </div>
            )}
            {hasPhysicalVoucher !== undefined && (
              <div className="flex gap-2 leading-tight">
                <dt className="w-10 flex-shrink-0 text-content-tertiary">凭证</dt>
                <dd className={`text-[10px] font-medium ${hasPhysicalVoucher ? 'text-emerald-600' : 'text-orange-500'}`}>
                  {hasPhysicalVoucher ? '已物理缝合' : '纯文字占位（待补录）'}
                </dd>
              </div>
            )}
            {tx.tags.length > 0 && (
              <div className="flex gap-2 leading-tight">
                <dt className="w-10 flex-shrink-0 text-content-tertiary">标签</dt>
                <dd className="flex flex-wrap gap-1">
                  {tx.tags.map(tag => (
                  <span key={tag}
                    className="px-1 py-0.5 bg-surface-tertiary rounded text-[10px] text-content-secondary">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
        </div>{/* end 左侧文字 */}

        {/* ── 右侧：凭证照片区（固定宽度，绝不向下撑开）── */}
        <div className="flex-shrink-0 w-[108px]">
          {receipts.length > 0 ? (
            <>
              {/* 单张照片 + 计数徽章 */}
              <div className="relative rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setLightboxIdx(photoIdx)}
                  className="block w-full focus:outline-none"
                  title="点击放大查看"
                >
                  <StorageImage
                    path={receipts[photoIdx]}
                    alt={`凭证 ${photoIdx + 1}`}
                    className="w-full h-[88px] object-cover"
                  />
                </button>
                {/* 1/N 计数徽章 */}
                {receipts.length > 1 && (
                  <div className="absolute top-1 right-1 px-1.5 py-0.5
                                  bg-black/65 rounded text-white text-[10px]
                                  font-bold leading-none pointer-events-none">
                    {photoIdx + 1}/{receipts.length}
                  </div>
                )}
              </div>

              {/* 多图翻页行（仅多张时渲染）*/}
              {receipts.length > 1 ? (
                <div className="flex items-center justify-between mt-1">
                  <button
                    type="button"
                    onClick={() => setPhotoIdx(i => (i - 1 + receipts.length) % receipts.length)}
                    className="w-7 h-6 flex items-center justify-center rounded
                               bg-surface-tertiary text-content-primary text-base
                               hover:bg-surface-secondary transition-colors"
                  >‹</button>
                  <span className="text-[9px] text-content-tertiary">点击放大</span>
                  <button
                    type="button"
                    onClick={() => setPhotoIdx(i => (i + 1) % receipts.length)}
                    className="w-7 h-6 flex items-center justify-center rounded
                               bg-surface-tertiary text-content-primary text-base
                               hover:bg-surface-secondary transition-colors"
                  >›</button>
                </div>
              ) : (
                <p className="text-[9px] text-content-tertiary text-center mt-1">点击放大</p>
              )}
            </>
          ) : isMigrated ? (
            <div className="w-full h-[88px] bg-amber-50 border border-amber-200 rounded-lg
                            flex flex-col items-center justify-center gap-1">
              <span className="text-xl">📭</span>
              <span className="text-[10px] text-amber-600 font-medium">暂无凭证</span>
            </div>
          ) : null}
        </div>{/* end 右侧照片 */}

      </div>{/* end flex-row 主信息区 */}

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

          {/* ── 强制入账：重复 / 待验证 ── */}
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

          {/* ── 合并：仅重复类型 ── */}
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

          {/* ══════════════════════════════════════════════════════
              缺凭证专属操作区（no_evidence 类型）
          ══════════════════════════════════════════════════════ */}
          {conflictType === 'no_evidence' && (
            <>
              {/* 隐藏文件选择器（图片 + PDF）*/}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) onAttachEvidence(file)
                  e.target.value = ''  // 允许重复选同一文件
                }}
                className="hidden"
              />

              {/* 【补传凭证】按钮 */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing || isUploading}
                className={[
                  'w-full py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-2',
                ].join(' ')}
              >
                {isUploading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>上传中 {uploadProgress}%</span>
                  </>
                ) : (
                  <>
                    <span>📎</span>
                    <span>补传凭证</span>
                  </>
                )}
              </button>

              {/* 上传进度条（仅上传中显示）*/}
              {isUploading && (
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden -mt-1">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}

              {/* 提示文案 */}
              <p className="text-[11px] text-content-tertiary px-1 -mt-1">
                支持 JPG / PNG / PDF · 单文件上限 10 MB
              </p>

              {/* 分隔线 */}
              <div className="flex items-center gap-2 my-1">
                <div className="flex-1 h-px bg-border-primary" />
                <span className="text-[10px] text-content-tertiary">或</span>
                <div className="flex-1 h-px bg-border-primary" />
              </div>

              {/* 【无凭证强行入账】按钮 */}
              <button
                onClick={onConfirmNoEvidence}
                disabled={isProcessing || isUploading}
                className={[
                  'w-full py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  'border-2 border-amber-400 text-amber-700',
                  'hover:bg-amber-50 active:bg-amber-100',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-2',
                ].join(' ')}
              >
                {isProcessing && (
                  <span className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-500 rounded-full animate-spin" />
                )}
                ⚡ 无凭证强行入账
              </button>

              {/* 说明文案 */}
              <p className="text-[11px] text-content-tertiary px-1 -mt-1">
                将打上「无凭证」标签并确认入账，此账单不再出现在缺凭证队列
              </p>
            </>
          )}

          {/* ── 作废：所有类型均可 ── */}
          <button
            onClick={onArchive}
            disabled={isProcessing || isUploading}
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
  const { allLedgerBills, billsReady }           = useBills()
  const { user }                                 = useAuthStore()
  const { selectedConflictId, selectConflict }   = useGovernanceStore()

  // ── 顶层视图（冲突列表 / 凭证管理）──────────────────────────
  const [mainView,        setMainView]        = useState<MainView>('conflicts')

  // ── UI 状态 ─────────────────────────────────────────────────
  const [filter,          setFilter]          = useState<ConflictFilter>('all')
  const [isProcessing,    setIsProcessing]    = useState(false)
  const [isUploading,     setIsUploading]     = useState(false)
  const [uploadProgress,  setUploadProgress]  = useState(0)
  const [errorMsg,        setErrorMsg]        = useState<string | null>(null)
  const [successMsg,      setSuccessMsg]      = useState<string | null>(null)
  const [mergeSourceId,   setMergeSourceId]   = useState<string | null>(null)
  // ── 批量操作状态 ─────────────────────────────────────────────
  const [batchSelected,   setBatchSelected]   = useState<Set<string>>(new Set())
  const [isBatchWorking,  setIsBatchWorking]  = useState(false)

  // ── 冲突数据 ────────────────────────────────────────────────
  const conflicts = useMemo(
    () => detectConflicts(allLedgerBills),
    [allLedgerBills],
  )

  const filtered = useMemo(
    () => filter === 'all' ? conflicts : conflicts.filter(c => c.conflictType === filter),
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

  // ── 成功提示自动消失 ─────────────────────────────────────────
  function showSuccess(msg: string): void {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  // ── 卡片点击 ────────────────────────────────────────────────
  function handleCardClick(item: ConflictItem): void {
    if (mergeSourceId) {
      if (item.tx.id === mergeSourceId) {
        setMergeSourceId(null)
      } else {
        void handleMergeConfirm(item.tx.id)
      }
    } else {
      selectConflict(selectedConflictId === item.tx.id ? null : item.tx.id)
      setErrorMsg(null)
    }
  }

  // ── 强制入账 ─────────────────────────────────────────────────
  async function handleForceAdd(): Promise<void> {
    if (!selectedItem || !user) return
    setIsProcessing(true); setErrorMsg(null)
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

  // ── 批量：切换单条选中 ───────────────────────────────────────
  function toggleBatchSelect(txId: string, e: React.MouseEvent): void {
    e.stopPropagation()
    setBatchSelected(prev => {
      const next = new Set(prev)
      next.has(txId) ? next.delete(txId) : next.add(txId)
      return next
    })
  }

  // ── 批量：全选 / 取消全选（当前筛选列表）───────────────────
  function toggleSelectAll(): void {
    const visibleIds = filtered.map(c => c.tx.id)
    const allSelected = visibleIds.every(id => batchSelected.has(id))
    setBatchSelected(allSelected ? new Set() : new Set(visibleIds))
  }

  // ── 批量自动入账（待验证队列）────────────────────────────────
  async function handleBatchForceAdd(): Promise<void> {
    if (!user || batchSelected.size === 0) return
    setIsBatchWorking(true); setErrorMsg(null)
    try {
      const result = await batchForceAdd(Array.from(batchSelected), user.uid)
      setBatchSelected(new Set())
      selectConflict(null)
      showSuccess(
        `✅ 批量入账完成：成功 ${result.succeeded} 条` +
        `（路径A有凭证 ${result.completeCount} 条 / 路径B纯文字 ${result.textOnlyCount} 条）` +
        (result.failed > 0 ? `，失败 ${result.failed} 条` : '')
      )
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '批量操作失败')
    } finally {
      setIsBatchWorking(false)
    }
  }

  // ── 批量无凭证强行入账（缺凭证队列）─────────────────────────
  async function handleBatchNoEvidence(): Promise<void> {
    if (!user || batchSelected.size === 0) return
    const confirmed = window.confirm(
      `确认对选中的 ${batchSelected.size} 条账单执行【无凭证强行入账】？\n` +
      `全部打标为 V2_TEXT_ONLY，后续可通过筛选该标签进行照片补录。`
    )
    if (!confirmed) return
    setIsBatchWorking(true); setErrorMsg(null)
    try {
      const result = await batchConfirmNoEvidence(Array.from(batchSelected), user.uid)
      setBatchSelected(new Set())
      selectConflict(null)
      showSuccess(
        `⚡ 批量无凭证入账完成：成功 ${result.succeeded} 条` +
        (result.failed > 0 ? `，失败 ${result.failed} 条` : '')
      )
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '批量操作失败')
    } finally {
      setIsBatchWorking(false)
    }
  }

  // ── 作废 ─────────────────────────────────────────────────────
  async function handleArchive(): Promise<void> {
    if (!selectedItem || !user) return
    const confirmed = window.confirm(
      `确认作废「${selectedItem.tx.description || selectedItem.tx.category}」` +
      `（${formatAmount(selectedItem.tx.amount)}）？\n\n此操作不可撤销，但可通过版本记录追溯。`
    )
    if (!confirmed) return
    setIsProcessing(true); setErrorMsg(null)
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

  // ── 进入合并模式 ─────────────────────────────────────────────
  function handleMergeStart(): void {
    if (!selectedItem) return
    setMergeSourceId(selectedItem.tx.id)
    setErrorMsg(null)
  }

  // ── 确认合并 ─────────────────────────────────────────────────
  async function handleMergeConfirm(targetId: string): Promise<void> {
    if (!mergeSourceId || !user) return
    setIsProcessing(true); setErrorMsg(null)
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

  // ── 无凭证强行入账 ───────────────────────────────────────────
  async function handleConfirmNoEvidence(): Promise<void> {
    if (!selectedItem || !user) return
    const confirmed = window.confirm(
      `确认以【无凭证】状态入账「${selectedItem.tx.description || selectedItem.tx.category}」` +
      `（${formatAmount(selectedItem.tx.amount)}）？\n\n该账单将打上「无凭证」标签并从缺凭证队列移除。`
    )
    if (!confirmed) return
    setIsProcessing(true); setErrorMsg(null)
    try {
      await confirmNoEvidence(selectedItem.tx.id, user.uid)
      selectConflict(null)
      showSuccess('⚡ 无凭证强行入账完成，已打标「无凭证」')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── 补传凭证 ─────────────────────────────────────────────────
  async function handleAttachEvidence(file: File): Promise<void> {
    if (!selectedItem || !user) return

    // 文件合法性校验
    const validation = validateFile(file)
    if (!validation.valid) {
      setErrorMsg(validation.message)
      return
    }

    setIsUploading(true)
    setUploadProgress(0)
    setErrorMsg(null)

    const { tx } = selectedItem
    try {
      // 阶段 1：上传文件到 Firebase Storage + 写 evidences 集合
      const evidence = await uploadEvidence(
        file,
        tx.id,
        tx.ledgerId,
        user.uid,
        (pct) => setUploadProgress(pct),
      )

      // 阶段 2：将 storageUrl 追加到 transaction.receiptUrls
      // → 使账单满足 receiptUrls.length > 0 → detectConflicts 自动移出 no_evidence 队列
      await attachEvidenceUrl(tx.id, evidence.storageUrl, user.uid)

      selectConflict(null)
      showSuccess(`✅ 凭证「${file.name}」已上传，缺凭证状态已解除`)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '凭证上传失败，请重试')
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  // ── 筛选变更（重置所有活动状态）────────────────────────────
  function handleFilterChange(f: ConflictFilter): void {
    setFilter(f)
    selectConflict(null)
    setMergeSourceId(null)
    setErrorMsg(null)
    setBatchSelected(new Set())
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

      {/* ═══ 页头 ═══ */}
      <div className="px-4 pt-5 pb-3 bg-surface-primary">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-content-primary tracking-tight">
              🛡️ 冲突与治理中心
            </h1>
            <p className="text-xs text-content-tertiary mt-0.5">
              {mainView === 'pool'
                ? '凭证池 — 管理未关联及已解绑的凭证文件'
                : conflicts.length > 0
                  ? `共发现 ${conflicts.length} 条数据质量问题待处理`
                  : '数据质量良好，暂无冲突记录'
              }
            </p>
          </div>
          {mainView === 'conflicts' && conflicts.length > 0 && (
            <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500 text-white text-sm font-bold shadow">
              {conflicts.length > 99 ? '99+' : conflicts.length}
            </span>
          )}
        </div>

        {/* ── 顶层视图切换 Tab ── */}
        <div className="flex gap-1.5 mt-3">
          <button
            onClick={() => setMainView('conflicts')}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
              mainView === 'conflicts'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary',
            ].join(' ')}
          >
            🛡️ 冲突列表
            {conflicts.length > 0 && (
              <span className={[
                'min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold',
                'inline-flex items-center justify-center',
                mainView === 'conflicts' ? 'bg-white/25 text-white' : 'bg-red-500 text-white',
              ].join(' ')}>
                {conflicts.length > 99 ? '99+' : conflicts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setMainView('pool')}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
              mainView === 'pool'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary',
            ].join(' ')}
          >
            🗄️ 凭证管理
          </button>
        </div>
      </div>

      {/* ═══ 凭证池视图（mainView === 'pool'）═══ */}
      {mainView === 'pool' && (
        <div className="flex-1">
          <ReceiptPool />
        </div>
      )}

      {/* ═══ 下方内容仅在 conflicts 视图时显示 ═══ */}
      {mainView === 'conflicts' && <>

      {/* ═══ 成功提示条 ═══ */}
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
          <div>
            {/* ── 批量操作工具栏（有选中项时显示）─────────────────── */}
            {filtered.length > 0 && (filter === 'pending' || filter === 'no_evidence') && (
              <div className="sticky top-0 z-10 px-4 py-2 bg-surface-primary border-b border-border-primary
                              flex items-center gap-2">
                {/* 全选复选框 */}
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className={[
                    'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                    filtered.every(c => batchSelected.has(c.tx.id))
                      ? 'bg-primary-600 border-primary-600'
                      : 'bg-white border-slate-300 hover:border-primary-400',
                  ].join(' ')}
                  aria-label="全选"
                >
                  {filtered.every(c => batchSelected.has(c.tx.id)) && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <span className="text-xs text-content-secondary flex-1">
                  {batchSelected.size > 0 ? `已选 ${batchSelected.size} 条` : '全选'}
                </span>

                {/* 待验证队列：批量自动入账 */}
                {filter === 'pending' && (
                  <button
                    onClick={() => { void handleBatchForceAdd() }}
                    disabled={batchSelected.size === 0 || isBatchWorking}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 text-white
                               hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed
                               flex items-center gap-1.5 transition-colors"
                  >
                    {isBatchWorking && (
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    ✅ 批量自动入账 {batchSelected.size > 0 ? `(${batchSelected.size})` : ''}
                  </button>
                )}

                {/* 缺凭证队列：批量强制入账（V2_TEXT_ONLY） */}
                {filter === 'no_evidence' && (
                  <button
                    onClick={() => { void handleBatchNoEvidence() }}
                    disabled={batchSelected.size === 0 || isBatchWorking}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white
                               hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed
                               flex items-center gap-1.5 transition-colors"
                  >
                    {isBatchWorking && (
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    ⚡ 批量强制入账 {batchSelected.size > 0 ? `(${batchSelected.size})` : ''}
                  </button>
                )}

                {/* 清空选择 */}
                {batchSelected.size > 0 && (
                  <button
                    onClick={() => setBatchSelected(new Set())}
                    className="px-2 py-1.5 rounded-lg text-xs text-content-secondary
                               hover:bg-surface-secondary transition-colors"
                  >
                    取消
                  </button>
                )}
              </div>
            )}

            {filtered.map((item) => (
              <div key={item.tx.id}>
                {/* 卡片行：复选框 + ConflictCard */}
                <div className="flex items-stretch">
                  {/* 复选框列（仅 pending / no_evidence 显示）*/}
                  {(filter === 'pending' || filter === 'no_evidence') && (
                    <button
                      type="button"
                      onClick={(e) => toggleBatchSelect(item.tx.id, e)}
                      className={[
                        'flex-shrink-0 w-10 flex items-center justify-center',
                        'border-r border-border-primary transition-colors',
                        batchSelected.has(item.tx.id)
                          ? 'bg-primary-50'
                          : 'bg-surface-primary hover:bg-surface-secondary',
                      ].join(' ')}
                      aria-label="选择此条冲突"
                    >
                      <div className={[
                        'w-4 h-4 rounded border-2 flex items-center justify-center',
                        batchSelected.has(item.tx.id)
                          ? 'bg-primary-600 border-primary-600'
                          : 'bg-white border-slate-400',
                      ].join(' ')}>
                        {batchSelected.has(item.tx.id) && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <ConflictCard
                      item={item}
                      isSelected={selectedConflictId === item.tx.id}
                      isMergeSource={mergeSourceId === item.tx.id}
                      isMergeMode={mergeSourceId !== null}
                      onClick={() => handleCardClick(item)}
                    />
                  </div>
                </div>

                {/* 详情面板：紧接在选中卡片下方内联展开 */}
                {selectedConflictId === item.tx.id && selectedItem !== null && (
                  <ConflictDetailPane
                    item={selectedItem}
                    isProcessing={isProcessing}
                    isUploading={isUploading}
                    uploadProgress={uploadProgress}
                    errorMsg={errorMsg}
                    mergeSourceId={mergeSourceId}
                    onForceAdd={() => { void handleForceAdd() }}
                    onArchive={() => { void handleArchive() }}
                    onMergeStart={handleMergeStart}
                    onMergeCancel={() => setMergeSourceId(null)}
                    onConfirmNoEvidence={() => { void handleConfirmNoEvidence() }}
                    onAttachEvidence={(file) => { void handleAttachEvidence(file) }}
                  />
                )}
              </div>
            ))}
            <div className="h-6" />
          </div>
        )}
      </div>

      </> /* end mainView === 'conflicts' */}

    </div>
  )
}
