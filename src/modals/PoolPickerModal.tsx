// PoolPickerModal — 从凭证池选择凭证并挂载到账单 (S21 Phase 2)
//
// 触发时机：用户在 OmniInputModal（编辑模式）点击「🗄️ 从凭证池关联」
//
// 展示：
//   · Pool B（解绑归档）列表：orphan / replaced 状态凭证（最常用，置顶）
//   · Pool A（待处理收件箱）列表：unprocessed 状态凭证
//
// 选中后：
//   调用 onSelect(evidence) → 父组件决定是否触发 AppendAmountModal

import { useState, useEffect }           from 'react'
import { StorageImage }                  from '@/components/ui/StorageImage'
import { subscribePoolEvidences }        from '@/services/firebase/evidenceService'
import type { Evidence }                 from '@/types/Evidence.types'

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ════════════════════════════════════════════════════════════════
// Props
// ════════════════════════════════════════════════════════════════

interface PoolPickerModalProps {
  /** 当前账套 ID（用于订阅凭证池）*/
  ledgerId: string
  /** 用户选中一张凭证后的回调 */
  onSelect: (evidence: Evidence) => void
  /** 取消 / 关闭 */
  onClose:  () => void
}

// ════════════════════════════════════════════════════════════════
// 单张凭证选择卡片
// ════════════════════════════════════════════════════════════════

interface EvidenceSelectCardProps {
  evidence:   Evidence
  onPick:     (ev: Evidence) => void
}

function EvidenceSelectCard({ evidence, onPick }: EvidenceSelectCardProps) {
  const [lightbox, setLightbox] = useState(false)
  const isImg = evidence.fileType?.startsWith('image/')

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary
                      hover:bg-surface-secondary transition-colors">

        {/* 缩略图 */}
        <button
          onClick={() => setLightbox(true)}
          className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0
                     border border-border-primary cursor-zoom-in
                     hover:ring-2 hover:ring-primary-400 transition-all"
        >
          {isImg ? (
            <StorageImage
              path={evidence.storageUrl}
              alt={evidence.fileName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-100 text-xl">
              📄
            </div>
          )}
        </button>

        {/* 文件元信息 */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-content-primary truncate">
            {evidence.fileName}
          </p>
          <p className="text-[10px] text-content-tertiary mt-0.5">
            {formatBytes(evidence.fileSizeBytes)} · {formatTime(evidence.uploadedAt)}
          </p>
          {evidence.originalTxId && (
            <p className="text-[10px] text-content-tertiary truncate">
              来自：<span className="font-mono">{evidence.originalTxId.slice(0, 10)}…</span>
            </p>
          )}
        </div>

        {/* 选择按钮 */}
        <button
          onClick={() => onPick(evidence)}
          className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold
                     bg-primary-600 hover:bg-primary-700 text-white transition-colors shadow-sm"
        >
          选择
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && isImg && (
        <div
          className="fixed inset-0 z-[750] flex items-center justify-center bg-black/85"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-xl"
            onClick={() => setLightbox(false)}
          >×</button>
          <StorageImage
            path={evidence.storageUrl}
            alt={evidence.fileName}
            className="max-w-[90vw] max-h-[80vh] rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════

type PoolTab = 'B' | 'A'

export default function PoolPickerModal({ ledgerId, onSelect, onClose }: PoolPickerModalProps) {
  const [poolA,      setPoolA]      = useState<Evidence[]>([])
  const [poolB,      setPoolB]      = useState<Evidence[]>([])
  const [activeTab,  setActiveTab]  = useState<PoolTab>('B')
  const [isLoading,  setIsLoading]  = useState(true)

  useEffect(() => {
    if (!ledgerId) return
    const unsub = subscribePoolEvidences(ledgerId, (pA, pB) => {
      setPoolA(pA)
      setPoolB(pB)
      setIsLoading(false)
    })
    return unsub
  }, [ledgerId])

  const currentList = activeTab === 'A' ? poolA : poolB
  const totalPoolSize = poolA.length + poolB.length

  return (
    <div
      className="fixed inset-0 z-[630] flex items-end sm:items-center justify-center
                 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface-primary rounded-t-3xl sm:rounded-2xl
                   shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* 移动端把手 */}
        <div className="flex justify-center pt-3 pb-0 sm:hidden">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border-primary flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-content-primary">🗄️ 从凭证池关联</h3>
            <p className="text-[11px] text-content-tertiary mt-0.5">
              {isLoading ? '加载中…' : totalPoolSize > 0 ? `共 ${totalPoolSize} 张可关联凭证` : '凭证池暂无可用凭证'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full
                       text-content-tertiary hover:text-content-primary hover:bg-surface-secondary
                       transition-colors text-lg"
          >
            ×
          </button>
        </div>

        {/* Tab 切换（flex-shrink-0 固定，不随列表滚动）
            inline style 保证激活色渲染，绕开 PurgeCSS                */}
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-border-primary flex-shrink-0">
          {([
            { key: 'B' as PoolTab, label: '🗂 解绑归档 (B)', count: poolB.length },
            { key: 'A' as PoolTab, label: '📥 待处理 (A)',   count: poolA.length },
          ] as const).map(({ key, label, count }) => {
            const isActive = activeTab === key
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
                  activeTab === key
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary',
                ].join(' ')}
              >
                {label}
                {count > 0 && (
                  <span
                    className={[
                      'min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold',
                      'inline-flex items-center justify-center',
                      activeTab === key
                        ? 'bg-white/25 text-white'
                        : 'bg-content-secondary/15 text-content-secondary',
                    ].join(' ')}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 凭证列表 */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <div className="w-5 h-5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              <p className="text-sm text-content-tertiary">加载凭证池…</p>
            </div>
          ) : currentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
              <span className="text-4xl">📭</span>
              <p className="text-sm font-semibold text-content-primary">
                {activeTab === 'B' ? 'Pool B 暂无解绑归档凭证' : 'Pool A 暂无待处理凭证'}
              </p>
              <p className="text-xs text-content-tertiary leading-relaxed">
                {activeTab === 'B'
                  ? '账单凭证解绑后会出现在这里，可重新挂载到其他账单'
                  : '直接上传到凭证池的图片会出现在这里'
                }
              </p>
              {activeTab === 'B' && poolA.length > 0 && (
                <button
                  onClick={() => setActiveTab('A')}
                  className="mt-1 text-xs text-primary-600 font-semibold"
                >
                  切换查看 Pool A ({poolA.length} 张)
                </button>
              )}
            </div>
          ) : (
            <>
              {currentList.map(ev => (
                <EvidenceSelectCard
                  key={ev.id}
                  evidence={ev}
                  onPick={onSelect}
                />
              ))}
              <div className="h-4" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
