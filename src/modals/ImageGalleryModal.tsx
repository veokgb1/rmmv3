// ImageGalleryModal — 账单凭证图集浏览弹窗 (S21 增强版)
//
// 触发时机：点击 BillItem / ConflictCard 上的 ThumbnailImage 缩略图
// 功能：
//   · 全屏轮播查看账单绑定的所有凭证（支持左右切换）
//   · 每张图片底部提供「🔗 解绑此凭证」药丸标签（触发 UnbindingModal）
//   · V2 数据（无 evidenceId）显示为加载中占位，不崩溃
//   · 关闭：点击遮罩 / 右上角 ✕
//
// 药丸标签颜色通过 inline style 保障（绕过 PurgeCSS）
// onSuccess 回调由调用方传入，用于在外层触发 Toast

import { useState, useEffect }  from 'react'
import { StorageImage }         from '@/components/ui/StorageImage'
import { subscribeEvidences }   from '@/services/firebase/evidenceService'
import { useGovernanceStore }   from '@/store/governanceStore'

// ════════════════════════════════════════════════════════════════
// Props
// ════════════════════════════════════════════════════════════════

interface ImageGalleryModalProps {
  /** 账单 Firestore 文档 ID */
  txId:           string
  /** Transaction.receiptUrls 数组 */
  receiptUrls:    string[]
  /** 初始显示的图片下标（默认 0）*/
  initialIndex?:  number
  /** 关闭回调 */
  onClose:        () => void
  /**
   * onUnbindSuccess — 解绑/硬删成功后的外部回调（可选）
   * 调用方可在此触发 Toast
   */
  onUnbindSuccess?: (action: 'unbound' | 'deleted') => void
}

// ════════════════════════════════════════════════════════════════
// Unlink SVG icon（内联，无需 icon 库）
// ════════════════════════════════════════════════════════════════

function UnlinkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      <line x1="5" y1="5" x2="19" y2="19"/>
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════

export default function ImageGalleryModal({
  txId,
  receiptUrls,
  initialIndex = 0,
  onClose,
  onUnbindSuccess,
}: ImageGalleryModalProps) {
  const [idx,       setIdx]       = useState(initialIndex)
  const [urlToEvId, setUrlToEvId] = useState<Record<string, string>>({})

  const openUnbindModal = useGovernanceStore(s => s.openUnbindModal)

  // 订阅 evidences 集合，建立 storageUrl → evidenceId 映射
  useEffect(() => {
    if (!txId) return
    const unsub = subscribeEvidences(txId, (evs) => {
      const map: Record<string, string> = {}
      evs.forEach(ev => { if (ev.status === 'ok') map[ev.storageUrl] = ev.id })
      setUrlToEvId(map)
    })
    return unsub
  }, [txId])

  if (receiptUrls.length === 0) return null

  const total      = receiptUrls.length
  const currentUrl = receiptUrls[idx] ?? ''
  const evId       = urlToEvId[currentUrl] ?? null

  function prev(e: React.MouseEvent): void {
    e.stopPropagation()
    setIdx((idx - 1 + total) % total)
  }
  function next(e: React.MouseEvent): void {
    e.stopPropagation()
    setIdx((idx + 1) % total)
  }

  function handleUnbind(e: React.MouseEvent): void {
    e.stopPropagation()
    if (!evId) return
    openUnbindModal({
      evidenceId:    evId,
      transactionId: txId,
      evidenceUrl:   currentUrl,
      onSuccess: (action) => {
        onUnbindSuccess?.(action)
      },
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[600] flex flex-col items-center justify-center
                 bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* ── 右上角关闭按钮 ── */}
      <button
        onClick={e => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center
                   rounded-full bg-white/15 text-white text-xl
                   hover:bg-white/30 transition-colors"
        aria-label="关闭"
      >
        ×
      </button>

      {/* ── 图片计数器 ── */}
      {total > 1 && (
        <p className="absolute top-4 left-1/2 -translate-x-1/2 z-10
                      text-xs text-white/70 font-medium tabular-nums select-none">
          {idx + 1} / {total}
        </p>
      )}

      {/* ── 主图区 ── */}
      <div
        className="relative flex items-center justify-center w-full max-w-2xl px-12"
        onClick={e => e.stopPropagation()}
      >
        {/* 上一张 */}
        {total > 1 && (
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10
                       w-10 h-10 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-2xl
                       hover:bg-white/30 transition-colors"
            aria-label="上一张"
          >
            ‹
          </button>
        )}

        <StorageImage
          path={currentUrl}
          alt={`凭证 ${idx + 1}`}
          className="max-w-full max-h-[70vh] rounded-xl object-contain shadow-2xl"
        />

        {/* 下一张 */}
        {total > 1 && (
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10
                       w-10 h-10 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-2xl
                       hover:bg-white/30 transition-colors"
            aria-label="下一张"
          >
            ›
          </button>
        )}
      </div>

      {/* ── 底部操作栏 ── */}
      <div
        className="mt-5 flex items-center gap-3"
        onClick={e => e.stopPropagation()}
      >
        {/* 导航点 */}
        {total > 1 && (
          <div className="flex items-center gap-1.5">
            {receiptUrls.map((_, i) => (
              <button
                key={i}
                onClick={e => { e.stopPropagation(); setIdx(i) }}
                className={[
                  'rounded-full transition-all duration-150',
                  i === idx ? 'w-4 h-2 bg-white' : 'w-2 h-2 bg-white/40 hover:bg-white/70',
                ].join(' ')}
                aria-label={`跳转到第 ${i + 1} 张`}
              />
            ))}
          </div>
        )}

        {/* ── 解绑药丸标签 ──
            · inline style 保证颜色渲染（绕过 PurgeCSS）
            · hover:scale-105 提升可点击感知
            · evId 无时（V2 数据/加载中）禁用并显示提示        */}
        {evId ? (
          <button
            onClick={handleUnbind}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full
                       text-white text-xs font-semibold
                       transition-transform hover:scale-105 active:scale-95 shadow-lg"
            style={{ background: 'rgba(245,158,11,0.92)' }}
          >
            <UnlinkIcon size={12} />
            <span>解绑此凭证</span>
          </button>
        ) : (
          // evidenceId 尚未加载 or V2 无文档（仅显示，不可交互）
          <div
            className="px-4 py-2 rounded-full text-xs"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
          >
            加载中…
          </div>
        )}
      </div>
    </div>
  )
}
