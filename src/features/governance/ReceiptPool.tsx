// ReceiptPool — 凭证池管理面板 (S21 Phase 3 强化版)
//
// Pool A（待处理收件箱）：status === 'unprocessed'
//   · 上传入口：【➕ 上传新凭证】按钮，直接写入 Pool A
//   · 卡片：序号、上传时间、AI 识别摘要（aiHints）、内联备注编辑
//
// Pool B（解绑归档）：status === 'orphan' | 'replaced'
//   · 卡片：来源溯源（原属账单日期 / 分类 / 金额）、解绑原因徽章
//   · 内联备注编辑
//
// 只有此组件提供永久物理删除（hardDeleteEvidence）入口
//
// ⚠️ Tab 样式注意：所有 Tailwind class 必须硬编码，不得动态拼接（会被 PurgeCSS 剔除）

import { useState, useEffect, useRef } from 'react'
import { StorageImage }  from '@/components/ui/StorageImage'
import {
  subscribePoolEvidences,
  hardDeleteEvidence,
  uploadToPool,
  updateEvidencePoolNote,
  validateFile,
} from '@/services/firebase/evidenceService'
import { useLedgerStore }  from '@/store/ledgerStore'
import { useAuthStore }    from '@/store/authStore'
import { formatAmount }    from '@/utils/numberUtils'
import type { Evidence }   from '@/types/Evidence.types'

// ════════════════════════════════════════════════════════════════
// § 0  浮动 Toast 系统（ReceiptPool 自洽，无需全局依赖）
// ════════════════════════════════════════════════════════════════

interface ToastItem {
  id:   number
  msg:  string
  type: 'success' | 'error' | 'warning'
}

/** 底部居中浮动气泡，自动消失，多条堆叠 */
function FloatingToastLayer({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="fixed bottom-24 inset-x-0 z-[900] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {items.map(t => (
        <div
          key={t.id}
          className={[
            'w-full max-w-sm px-4 py-3 rounded-2xl shadow-2xl',
            'text-sm font-semibold text-white text-center',
            'flex items-center justify-center gap-2',
            t.type === 'success' ? 'bg-teal-600'
              : t.type === 'error'   ? 'bg-red-500'
              : 'bg-amber-500',
          ].join(' ')}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

/** Toast 管理 hook（组件内使用） */
function useToast() {
  const [items, setItems] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  function push(msg: string, type: ToastItem['type'] = 'success', duration = 3500) {
    const id = ++counterRef.current
    setItems(prev => [...prev, { id, msg, type }])
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), duration)
  }

  return { items, push }
}

// ════════════════════════════════════════════════════════════════
// § 1  工具函数
// ════════════════════════════════════════════════════════════════

function fmtBytes(bytes: number): string {
  if (!bytes)              return '— KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtShortDate(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ════════════════════════════════════════════════════════════════
// § 2  内联备注编辑器（Pool A / B 通用）
// ════════════════════════════════════════════════════════════════

interface InlineNoteEditorProps {
  evidenceId:  string
  initialNote: string
  onSaved?:    () => void
}

function InlineNoteEditor({ evidenceId, initialNote, onSaved }: InlineNoteEditorProps) {
  const [editing, setEditing]   = useState(false)
  const [val,     setVal]       = useState(initialNote)
  const [saving,  setSaving]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setVal(initialNote) }, [initialNote])

  async function save() {
    if (val === initialNote) { setEditing(false); return }
    setSaving(true)
    try {
      await updateEvidencePoolNote(evidenceId, val.trim())
      setEditing(false)
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 50) }}
        className="flex items-center gap-1 mt-1 text-[10px] text-content-tertiary
                   hover:text-primary-600 transition-colors group"
      >
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
        <span className="italic">
          {val.trim() ? `💬 ${val}` : '+ 添加备注…'}
        </span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <input
        ref={inputRef}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  void save()
          if (e.key === 'Escape') { setVal(initialNote); setEditing(false) }
        }}
        placeholder="添加备注（回车保存）"
        maxLength={100}
        className="flex-1 px-2 py-0.5 text-[10px] bg-white border border-primary-300
                   rounded-lg outline-none focus:ring-1 focus:ring-primary-400"
      />
      <button
        onClick={() => void save()}
        disabled={saving}
        className="px-2 py-0.5 text-[10px] rounded-lg bg-primary-600 text-white
                   hover:bg-primary-700 disabled:opacity-50 transition-colors"
      >
        {saving ? '…' : '保存'}
      </button>
      <button
        onClick={() => { setVal(initialNote); setEditing(false) }}
        className="px-1.5 py-0.5 text-[10px] rounded-lg text-content-tertiary
                   hover:bg-surface-secondary transition-colors"
      >
        取消
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 3  Pool A 卡片（待处理收件箱）
// ════════════════════════════════════════════════════════════════

interface PoolACardProps {
  evidence:    Evidence
  index:       number
  onHardDelete:(ev: Evidence) => void
  isDeleting:  boolean
}

function PoolACard({ evidence, index, onHardDelete, isDeleting }: PoolACardProps) {
  const [lightbox, setLightbox] = useState(false)
  const isImg = evidence.fileType?.startsWith('image/')

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border-primary
                      bg-surface-primary hover:bg-surface-secondary transition-colors">

        {/* 序号徽章 */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700
                           text-[10px] font-bold flex items-center justify-center">
            {index + 1}
          </span>
          {/* 缩略图（可放大）*/}
          <button
            onClick={() => setLightbox(true)}
            className="w-12 h-12 rounded-xl overflow-hidden border border-border-primary
                       cursor-zoom-in hover:ring-2 hover:ring-teal-400 transition-all mt-1"
          >
            {isImg ? (
              <StorageImage path={evidence.storageUrl} alt={evidence.fileName}
                            className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-100 text-lg">📄</div>
            )}
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-content-primary truncate">{evidence.fileName}</p>
          <p className="text-[10px] text-content-tertiary mt-0.5">
            {fmtBytes(evidence.fileSizeBytes)} · {fmtDate(evidence.uploadedAt)}
          </p>

          {/* AI 识别摘要 */}
          {evidence.aiHints && (evidence.aiHints.merchant || evidence.aiHints.amount) && (
            <div className="mt-1 px-2 py-1 bg-teal-50 border border-teal-100 rounded-lg
                            flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-bold text-teal-600 uppercase tracking-wide">AI</span>
              {evidence.aiHints.merchant && (
                <span className="text-[10px] text-teal-700">{evidence.aiHints.merchant}</span>
              )}
              {evidence.aiHints.amount && (
                <span className="text-[10px] font-bold text-teal-700">
                  ¥{formatAmount(evidence.aiHints.amount)}
                </span>
              )}
              {evidence.aiHints.date && (
                <span className="text-[10px] text-teal-500">{evidence.aiHints.date}</span>
              )}
            </div>
          )}

          {/* 内联备注编辑 */}
          <InlineNoteEditor evidenceId={evidence.id} initialNote={evidence.poolNote ?? ''} />

          {/* 状态徽章 */}
          <span className="inline-flex items-center mt-1.5 px-1.5 py-0.5 rounded
                           text-[9px] font-bold bg-teal-100 text-teal-700">
            待处理
          </span>
        </div>

        {/* 永久删除 */}
        <button
          onClick={() => onHardDelete(evidence)}
          disabled={isDeleting}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full
                     text-content-tertiary hover:bg-red-50 hover:text-red-500
                     disabled:opacity-40 transition-colors"
          title="永久删除（不可恢复）"
        >
          🗑
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && isImg && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/85"
             onClick={() => setLightbox(false)}>
          <button className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                             rounded-full bg-white/15 text-white text-xl"
                  onClick={() => setLightbox(false)}>×</button>
          <StorageImage path={evidence.storageUrl} alt={evidence.fileName}
                        className="max-w-[92vw] max-h-[80vh] rounded-xl object-contain shadow-2xl"
                        onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// § 4  Pool B 卡片（解绑归档）
// ════════════════════════════════════════════════════════════════

interface PoolBCardProps {
  evidence:    Evidence
  index:       number
  onHardDelete:(ev: Evidence) => void
  isDeleting:  boolean
}

function PoolBCard({ evidence, index, onHardDelete, isDeleting }: PoolBCardProps) {
  const [lightbox, setLightbox] = useState(false)
  const isImg = evidence.fileType?.startsWith('image/')

  const reasonLabel = evidence.orphanReason === 'replaced' ? '替代解绑' : '手动剥离'
  const reasonColor = evidence.orphanReason === 'replaced'
    ? 'bg-slate-100 text-slate-600'
    : 'bg-amber-100 text-amber-700'

  // 来源溯源：优先使用快照字段，降级显示 ID 片段
  const hasSourceMeta = !!(evidence.orphanFromDate || evidence.orphanFromCategory || evidence.orphanFromAmount)

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border-primary
                      bg-surface-primary hover:bg-surface-secondary transition-colors">

        {/* 序号 + 缩略图 */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700
                           text-[10px] font-bold flex items-center justify-center">
            {index + 1}
          </span>
          <button
            onClick={() => setLightbox(true)}
            className="w-12 h-12 rounded-xl overflow-hidden border border-border-primary
                       cursor-zoom-in hover:ring-2 hover:ring-amber-400 transition-all mt-1"
          >
            {isImg ? (
              <StorageImage path={evidence.storageUrl} alt={evidence.fileName}
                            className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-100 text-lg">📄</div>
            )}
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[12px] font-semibold text-content-primary truncate">{evidence.fileName}</p>
            {/* 解绑原因徽章 */}
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${reasonColor}`}>
              {reasonLabel}
            </span>
          </div>

          {/* 解绑时间 */}
          <p className="text-[10px] text-content-tertiary mt-0.5">
            {evidence.orphanedAt
              ? `解绑于 ${fmtShortDate(evidence.orphanedAt)}`
              : `上传于 ${fmtShortDate(evidence.uploadedAt)}`
            }
          </p>

          {/* 来源溯源（快照字段 or ID 降级）*/}
          <div className="mt-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">
              原属账单
            </p>
            {hasSourceMeta ? (
              <p className="text-[11px] text-slate-600 leading-snug">
                {evidence.orphanFromDate && (
                  <span className="font-medium">{evidence.orphanFromDate}</span>
                )}
                {evidence.orphanFromCategory && (
                  <span className="text-slate-500"> · {evidence.orphanFromCategory}</span>
                )}
                {evidence.orphanFromAmount !== undefined && evidence.orphanFromAmount !== 0 && (
                  <span className={`font-bold ml-1 ${(evidence.orphanFromAmount ?? 0) > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                    {(evidence.orphanFromAmount ?? 0) > 0 ? '+' : '−'}¥{formatAmount(Math.abs(evidence.orphanFromAmount ?? 0))}
                  </span>
                )}
              </p>
            ) : evidence.originalTxId ? (
              <p className="text-[10px] font-mono text-slate-500 truncate">
                ID: {evidence.originalTxId.slice(0, 16)}…
              </p>
            ) : (
              <p className="text-[10px] text-slate-400 italic">来源不详</p>
            )}
          </div>

          {/* 内联备注编辑 */}
          <InlineNoteEditor evidenceId={evidence.id} initialNote={evidence.poolNote ?? ''} />
        </div>

        {/* 永久删除 */}
        <button
          onClick={() => onHardDelete(evidence)}
          disabled={isDeleting}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full
                     text-content-tertiary hover:bg-red-50 hover:text-red-500
                     disabled:opacity-40 transition-colors"
          title="永久删除（不可恢复）"
        >
          🗑
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && isImg && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/85"
             onClick={() => setLightbox(false)}>
          <button className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                             rounded-full bg-white/15 text-white text-xl"
                  onClick={() => setLightbox(false)}>×</button>
          <StorageImage path={evidence.storageUrl} alt={evidence.fileName}
                        className="max-w-[92vw] max-h-[80vh] rounded-xl object-contain shadow-2xl"
                        onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// § 5  硬删确认弹窗
// ════════════════════════════════════════════════════════════════

function HardDeleteConfirm({
  evidence, onConfirm, onCancel, isDeleting,
}: {
  evidence: Evidence; onConfirm: () => void; onCancel: () => void; isDeleting: boolean
}) {
  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center
                    bg-black/60 backdrop-blur-sm px-4"
         onClick={onCancel}>
      <div className="w-full max-w-sm bg-surface-primary rounded-2xl shadow-2xl overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="h-1 bg-gradient-to-r from-red-500 via-orange-400 to-red-500" />
        <div className="px-5 pt-5 pb-1 flex items-start gap-3">
          <span className="text-2xl mt-0.5">🗑</span>
          <div>
            <h3 className="text-base font-bold text-content-primary">永久删除凭证？</h3>
            <p className="text-[11px] text-content-tertiary mt-0.5">此操作不可撤销</p>
          </div>
        </div>
        <div className="px-5 py-3">
          <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-xs text-red-700">
              ⚠️ <strong>{evidence.fileName}</strong>（{fmtBytes(evidence.fileSizeBytes)}）将被彻底删除。
            </p>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onCancel} disabled={isDeleting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-surface-secondary
                             text-content-secondary hover:bg-surface-tertiary transition-colors disabled:opacity-50">
            取消
          </button>
          <button onClick={onConfirm} disabled={isDeleting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500
                             hover:bg-red-600 text-white transition-colors disabled:opacity-50
                             flex items-center justify-center gap-2">
            {isDeleting
              ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/><span>删除中…</span></>
              : <span>确认永久删除</span>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 6  Pool A 上传区
// ════════════════════════════════════════════════════════════════

interface PoolAUploadAreaProps {
  ledgerId:   string
  uploadedBy: string
  onSuccess:  (msg: string) => void
  onError:    (msg: string) => void
}

function PoolAUploadArea({ ledgerId, uploadedBy, onSuccess, onError }: PoolAUploadAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading,  setUploading] = useState(false)
  const [progress,   setProgress]  = useState(0)

  async function handleFile(file: File) {
    const validation = validateFile(file)
    if (!validation.valid) { onError(validation.message); return }
    setUploading(true)
    setProgress(0)
    try {
      await uploadToPool(file, ledgerId, uploadedBy, pct => setProgress(pct))
      onSuccess(`✅ 「${file.name}」已上传至 Pool A`)
    } catch (e) {
      onError(e instanceof Error ? e.message : '上传失败，请重试')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }

  return (
    <div className="px-4 py-3 border-b border-border-primary bg-teal-50/60">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleChange}
      />
      {uploading ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-teal-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-teal-700 tabular-nums w-10 text-right">
            {progress}%
          </span>
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2
                     px-4 py-2.5 rounded-xl border-2 border-dashed border-teal-400
                     bg-white hover:bg-teal-50 text-teal-700 hover:border-teal-500
                     text-sm font-semibold transition-all"
        >
          <span className="text-lg">➕</span>
          上传新凭证到 Pool A
        </button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 7  Tab 颜色令牌（全部用 inline style，彻底绕过 PurgeCSS）
// ════════════════════════════════════════════════════════════════

/**
 * 用 React.CSSProperties inline style 定义背景色 / 文字色 / 阴影。
 * Tailwind className 只负责布局/间距，颜色由 style 保证 100% 渲染。
 */
const TAB_BASE_CLASS =
  'flex-1 flex flex-col items-start px-3 py-2.5 rounded-xl transition-all duration-200 text-left'

const TAB_STYLE_ACTIVE_A: React.CSSProperties = {
  background:  '#0d9488',   // teal-600
  color:       '#ffffff',
  boxShadow:   '0 2px 8px rgba(13,148,136,0.5), 0 0 0 3px rgba(153,246,228,0.6)',
  border:      '1.5px solid #0d9488',
}
const TAB_STYLE_INACTIVE_A: React.CSSProperties = {
  background:  '#ffffff',
  color:       '#334155',   // slate-700
  border:      '1.5px solid #cbd5e1',  // slate-300
}
const TAB_STYLE_ACTIVE_B: React.CSSProperties = {
  background:  '#f59e0b',   // amber-500
  color:       '#ffffff',
  boxShadow:   '0 2px 8px rgba(245,158,11,0.5), 0 0 0 3px rgba(253,230,138,0.6)',
  border:      '1.5px solid #f59e0b',
}
const TAB_STYLE_INACTIVE_B: React.CSSProperties = {
  background:  '#ffffff',
  color:       '#334155',
  border:      '1.5px solid #cbd5e1',
}

// ════════════════════════════════════════════════════════════════
// § 8  主组件
// ════════════════════════════════════════════════════════════════

type PoolTab = 'A' | 'B'

export default function ReceiptPool() {
  const activeLedgerId = useLedgerStore(s => s.activeLedgerId)
  const currentUserId  = useAuthStore(s => s.user?.uid ?? '')

  const [poolA,             setPoolA]            = useState<Evidence[]>([])
  const [poolB,             setPoolB]            = useState<Evidence[]>([])
  const [activeTab,         setActiveTab]        = useState<PoolTab>('B')
  const [hardDeleteTarget,  setHardDeleteTarget] = useState<Evidence | null>(null)
  const [isDeleting,        setIsDeleting]       = useState(false)

  const toast = useToast()

  useEffect(() => {
    if (!activeLedgerId) return
    return subscribePoolEvidences(activeLedgerId, (pA, pB) => {
      setPoolA(pA); setPoolB(pB)
    })
  }, [activeLedgerId])

  async function handleHardDeleteConfirm() {
    if (!hardDeleteTarget) return
    setIsDeleting(true)
    const name = hardDeleteTarget.fileName
    try {
      await hardDeleteEvidence(hardDeleteTarget.id, hardDeleteTarget.storagePath)
      setHardDeleteTarget(null)
      toast.push(`🗑 已永久删除：${name}`, 'warning')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : '删除失败，请重试', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const currentList = activeTab === 'A' ? poolA : poolB

  return (
    <div className="flex flex-col min-h-full bg-surface-primary">

      {/* ═══ 页头 ═══ */}
      <div className="px-4 pt-4 pb-3 border-b border-border-primary">
        <h2 className="text-base font-bold text-content-primary">🗄️ 凭证池</h2>
        <p className="text-xs text-content-tertiary mt-0.5 leading-relaxed">
          Pool A：未关联收件箱 · Pool B：解绑归档
          <span className="ml-1 text-red-500 font-semibold">· 永久删除仅限此处</span>
        </p>
      </div>

      {/* ═══ Tab 切换（inline style 保证颜色，不依赖 Tailwind PurgeCSS）═══ */}
      <div className="flex gap-2 px-4 py-3 border-b border-border-primary" style={{ background: '#f8fafc' }}>

        {/* Pool B Tab（解绑归档）*/}
        <button
          onClick={() => setActiveTab('B')}
          className={TAB_BASE_CLASS}
          style={activeTab === 'B' ? TAB_STYLE_ACTIVE_B : TAB_STYLE_INACTIVE_B}
        >
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-xs font-bold">🗂 Pool B</span>
            <span style={{ fontSize: 10, opacity: activeTab === 'B' ? 0.85 : 0.6 }}>解绑归档</span>
            {poolB.length > 0 && (
              <span
                className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           inline-flex items-center justify-center"
                style={activeTab === 'B'
                  ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { background: '#fef3c7', color: '#92400e' }
                }
              >
                {poolB.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 9, opacity: 0.65, fontFamily: 'monospace', marginTop: 2 }}>
            orphan / replaced
          </span>
        </button>

        {/* Pool A Tab（待处理）*/}
        <button
          onClick={() => setActiveTab('A')}
          className={TAB_BASE_CLASS}
          style={activeTab === 'A' ? TAB_STYLE_ACTIVE_A : TAB_STYLE_INACTIVE_A}
        >
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-xs font-bold">📥 Pool A</span>
            <span style={{ fontSize: 10, opacity: activeTab === 'A' ? 0.85 : 0.6 }}>待处理</span>
            {poolA.length > 0 && (
              <span
                className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           inline-flex items-center justify-center"
                style={activeTab === 'A'
                  ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { background: '#ccfbf1', color: '#0f766e' }
                }
              >
                {poolA.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 9, opacity: 0.65, fontFamily: 'monospace', marginTop: 2 }}>
            unprocessed
          </span>
        </button>
      </div>

      {/* ═══ Pool A 上传区（仅 Pool A tab 显示）═══ */}
      {activeTab === 'A' && activeLedgerId && (
        <PoolAUploadArea
          ledgerId={activeLedgerId}
          uploadedBy={currentUserId}
          onSuccess={msg => toast.push(msg, 'success')}
          onError={msg   => toast.push(msg, 'error')}
        />
      )}

      {/* ═══ 列表 ═══ */}
      <div className="flex-1">
        {currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <span className="text-4xl">📭</span>
            <p className="text-sm font-semibold text-content-primary">
              {activeTab === 'A' ? '待处理池为空' : '解绑归档池为空'}
            </p>
            <p className="text-xs text-content-tertiary leading-relaxed">
              {activeTab === 'A'
                ? '点击上方【➕ 上传新凭证到 Pool A】将文件存入待处理池'
                : '账单凭证被手动解绑后会出现在这里，可重新挂载到其他账单'}
            </p>
          </div>
        ) : (
          <div>
            <div className="px-4 py-2 bg-surface-secondary border-b border-border-primary">
              <p className="text-[11px] text-content-tertiary">
                共 {currentList.length} 张 · 点击缩略图预览 · 🗑 永久删除不可恢复
              </p>
            </div>
            {activeTab === 'A'
              ? poolA.map((ev, i) => (
                  <PoolACard
                    key={ev.id}
                    evidence={ev}
                    index={i}
                    onHardDelete={setHardDeleteTarget}
                    isDeleting={isDeleting && hardDeleteTarget?.id === ev.id}
                  />
                ))
              : poolB.map((ev, i) => (
                  <PoolBCard
                    key={ev.id}
                    evidence={ev}
                    index={i}
                    onHardDelete={setHardDeleteTarget}
                    isDeleting={isDeleting && hardDeleteTarget?.id === ev.id}
                  />
                ))
            }
            <div className="h-6" />
          </div>
        )}
      </div>

      {/* ═══ 硬删确认 ═══ */}
      {hardDeleteTarget && (
        <HardDeleteConfirm
          evidence={hardDeleteTarget}
          onConfirm={() => { void handleHardDeleteConfirm() }}
          onCancel={() => { if (!isDeleting) { setHardDeleteTarget(null) } }}
          isDeleting={isDeleting}
        />
      )}

      {/* ═══ 浮动 Toast 气泡（自洽，无需全局依赖）═══ */}
      <FloatingToastLayer items={toast.items} />
    </div>
  )
}
