// ReceiptPool — 凭证池管理面板 (S21)
//
// 职责：展示双轨制凭证池，支持永久硬删凭证
//
// Pool A（待处理收件箱）：status === 'unprocessed'
//   新上传但从未关联到任何账单的凭证（如：直接从凭证池上传、OCR 后未匹配）
//
// Pool B（解绑归档）：status === 'orphan' | 'replaced'
//   曾绑定账单、被用户主动解绑（orphan）或账单合并时被替换（replaced）
//
// 只有此组件才提供永久物理删除（hardDeleteEvidence）入口。
// 主账单流程中的解绑只调用 softUnbindEvidence，凭证永远先进入此池。

import { useState, useEffect }           from 'react'
import { StorageImage }                  from '@/components/ui/StorageImage'
import { subscribePoolEvidences, hardDeleteEvidence } from '@/services/firebase/evidenceService'
import { useLedgerStore }                from '@/store/ledgerStore'
import type { Evidence }                 from '@/types/Evidence.types'

// ════════════════════════════════════════════════════════════════
// § 1  工具函数
// ════════════════════════════════════════════════════════════════

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ════════════════════════════════════════════════════════════════
// § 2  单张凭证卡片
// ════════════════════════════════════════════════════════════════

interface EvidenceCardProps {
  evidence:    Evidence
  onHardDelete: (ev: Evidence) => void
  isDeleting:  boolean
}

function EvidenceCard({ evidence, onHardDelete, isDeleting }: EvidenceCardProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const isOrphan = evidence.status === 'orphan' || evidence.status === 'replaced'

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border-primary
                      bg-surface-primary hover:bg-surface-secondary transition-colors">

        {/* 缩略图 */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setLightboxOpen(true)}
          onKeyDown={e => e.key === 'Enter' && setLightboxOpen(true)}
          className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0
                     border border-border-primary cursor-zoom-in
                     hover:ring-2 hover:ring-primary-400 transition-all"
        >
          {evidence.fileType.startsWith('image/') ? (
            <StorageImage
              path={evidence.storageUrl}
              alt={evidence.fileName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center
                            bg-slate-100 text-2xl">
              📄
            </div>
          )}
        </div>

        {/* 凭证元信息 */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-content-primary truncate leading-snug">
            {evidence.fileName}
          </p>
          <p className="text-[10px] text-content-tertiary mt-0.5">
            {formatBytes(evidence.fileSizeBytes)} · {formatTime(evidence.uploadedAt)}
          </p>

          {/* orphan/replaced 额外信息：来源账单 */}
          {isOrphan && evidence.originalTxId && (
            <p className="text-[10px] text-content-tertiary mt-0.5 truncate">
              来自账单：<span className="font-mono">{evidence.originalTxId.slice(0, 12)}…</span>
              {evidence.orphanedAt
                ? ` · 解绑于 ${formatTime(evidence.orphanedAt)}`
                : ''}
            </p>
          )}

          {/* 状态徽章 */}
          <span className={[
            'inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
            evidence.status === 'unprocessed' ? 'bg-blue-100 text-blue-700' :
            evidence.status === 'orphan'      ? 'bg-amber-100 text-amber-700' :
                                                'bg-slate-100 text-slate-500',
          ].join(' ')}>
            {evidence.status === 'unprocessed' ? '待处理' :
             evidence.status === 'orphan'      ? '已解绑' : '已替换'}
          </span>
        </div>

        {/* 永久删除按钮 */}
        <button
          onClick={() => onHardDelete(evidence)}
          disabled={isDeleting}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center
                     rounded-full text-content-tertiary
                     hover:bg-red-50 hover:text-red-500
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
          title="永久删除（不可恢复）"
        >
          🗑
        </button>
      </div>

      {/* Lightbox 全屏查看 */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[700] flex items-center justify-center bg-black/85"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-xl hover:bg-white/25"
            onClick={() => setLightboxOpen(false)}
          >
            ×
          </button>
          <StorageImage
            path={evidence.storageUrl}
            alt={evidence.fileName}
            className="max-w-[92vw] max-h-[80vh] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// § 3  硬删确认弹窗（内联，避免引入新弹窗层级）
// ════════════════════════════════════════════════════════════════

interface HardDeleteConfirmProps {
  evidence:    Evidence
  onConfirm:   () => void
  onCancel:    () => void
  isDeleting:  boolean
}

function HardDeleteConfirm({ evidence, onConfirm, onCancel, isDeleting }: HardDeleteConfirmProps) {
  return (
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center
                 bg-black/60 backdrop-blur-sm px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-surface-primary rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1 bg-gradient-to-r from-red-500 via-orange-400 to-red-500" />

        <div className="px-5 pt-5 pb-1">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none mt-0.5">🗑</span>
            <div>
              <h3 className="text-base font-bold text-content-primary">永久删除凭证？</h3>
              <p className="text-[11px] text-content-tertiary mt-0.5">
                此操作不可撤销，文件将从 Firebase Storage 彻底删除
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-xs text-red-700 leading-relaxed">
              ⚠️ <strong>{evidence.fileName}</strong>（{formatBytes(evidence.fileSizeBytes)}）
              将被永久删除，无法找回。
            </p>
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium
                       bg-surface-secondary text-content-secondary
                       hover:bg-surface-tertiary transition-colors
                       disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold
                       bg-red-500 hover:bg-red-600 text-white transition-colors
                       disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>删除中…</span>
              </>
            ) : (
              <span>确认永久删除</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 4  空状态占位
// ════════════════════════════════════════════════════════════════

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <span className="text-4xl">📭</span>
      <p className="text-sm font-semibold text-content-primary">{label}</p>
      <p className="text-xs text-content-tertiary">凭证池为空，暂无待处理项目</p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 5  主组件：凭证池面板
// ════════════════════════════════════════════════════════════════

type PoolTab = 'A' | 'B'

export default function ReceiptPool() {
  const activeLedgerId = useLedgerStore(s => s.activeLedgerId)

  const [poolA,        setPoolA]        = useState<Evidence[]>([])
  const [poolB,        setPoolB]        = useState<Evidence[]>([])
  const [activeTab,    setActiveTab]    = useState<PoolTab>('B')
  const [hardDeleteTarget, setHardDeleteTarget] = useState<Evidence | null>(null)
  const [isDeleting,   setIsDeleting]   = useState(false)
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null)
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)

  // 订阅凭证池
  useEffect(() => {
    if (!activeLedgerId) return
    const unsub = subscribePoolEvidences(activeLedgerId, (pA, pB) => {
      setPoolA(pA)
      setPoolB(pB)
    })
    return unsub
  }, [activeLedgerId])

  // 成功提示自动消失
  function showSuccess(msg: string): void {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  // 硬删除确认
  async function handleHardDeleteConfirm(): Promise<void> {
    if (!hardDeleteTarget) return
    setIsDeleting(true)
    setErrorMsg(null)
    try {
      await hardDeleteEvidence(hardDeleteTarget.id, hardDeleteTarget.storagePath)
      setHardDeleteTarget(null)
      showSuccess(`🗑 已永久删除：${hardDeleteTarget.fileName}`)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '删除失败，请重试')
    } finally {
      setIsDeleting(false)
    }
  }

  const currentList = activeTab === 'A' ? poolA : poolB

  // ── 渲染 ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full bg-surface-primary">

      {/* ═══ 页头说明 ═══ */}
      <div className="px-4 pt-4 pb-3 border-b border-border-primary">
        <h2 className="text-base font-bold text-content-primary">🗄️ 凭证池</h2>
        <p className="text-xs text-content-tertiary mt-0.5 leading-relaxed">
          凭证池暂存未关联（Pool A）和已解绑（Pool B）的凭证文件。
          <br />
          <strong className="text-red-500">永久删除</strong>操作只能在此处执行。
        </p>
      </div>

      {/* ═══ 成功 / 错误提示 ═══ */}
      {successMsg && (
        <div className="mx-4 mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-xs text-green-700 font-semibold">{successMsg}</p>
        </div>
      )}
      {errorMsg && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-xs text-red-600">{errorMsg}</p>
        </div>
      )}

      {/* ═══ Pool 标签页 ═══ */}
      <div className="flex gap-1 px-4 py-2.5 border-b border-border-primary">
        {([
          { key: 'B' as PoolTab, label: 'Pool B — 解绑归档', count: poolB.length, desc: 'orphan / replaced' },
          { key: 'A' as PoolTab, label: 'Pool A — 待处理收件箱', count: poolA.length, desc: 'unprocessed' },
        ] as const).map(({ key, label, count, desc }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={[
              'flex-1 flex flex-col items-start px-3 py-2 rounded-xl border transition-all',
              activeTab === key
                ? 'bg-primary-50 border-primary-300 shadow-sm'
                : 'bg-surface-secondary border-border-primary hover:bg-surface-tertiary',
            ].join(' ')}
          >
            <div className="flex items-center gap-1.5 w-full">
              <span className={[
                'text-xs font-semibold',
                activeTab === key ? 'text-primary-700' : 'text-content-primary',
              ].join(' ')}>
                {label}
              </span>
              {count > 0 && (
                <span className={[
                  'ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                  'inline-flex items-center justify-center',
                  activeTab === key ? 'bg-primary-600 text-white' : 'bg-content-tertiary/20 text-content-secondary',
                ].join(' ')}>
                  {count}
                </span>
              )}
            </div>
            <span className="text-[10px] text-content-tertiary font-mono">{desc}</span>
          </button>
        ))}
      </div>

      {/* ═══ 凭证列表 ═══ */}
      <div className="flex-1">
        {currentList.length === 0 ? (
          <EmptyState label={activeTab === 'A' ? 'Pool A 为空' : 'Pool B 为空'} />
        ) : (
          <div>
            <div className="px-4 py-2 bg-surface-secondary border-b border-border-primary">
              <p className="text-[11px] text-content-tertiary">
                共 {currentList.length} 张凭证 · 点击缩略图可预览 · 🗑 永久删除后不可恢复
              </p>
            </div>
            {currentList.map(ev => (
              <EvidenceCard
                key={ev.id}
                evidence={ev}
                onHardDelete={setHardDeleteTarget}
                isDeleting={isDeleting && hardDeleteTarget?.id === ev.id}
              />
            ))}
            <div className="h-6" />
          </div>
        )}
      </div>

      {/* ═══ 硬删确认弹窗 ═══ */}
      {hardDeleteTarget && (
        <HardDeleteConfirm
          evidence={hardDeleteTarget}
          onConfirm={() => { void handleHardDeleteConfirm() }}
          onCancel={() => { if (!isDeleting) { setHardDeleteTarget(null); setErrorMsg(null) } }}
          isDeleting={isDeleting}
        />
      )}
    </div>
  )
}
