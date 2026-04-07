// EvidenceList — 凭证缩略图列表组件 (S21)
//
// 职责：
//   · 内联 useEvidences hook，实时订阅指定账单的 evidences 集合
//   · 以网格形式渲染凭证缩略图（图片预览 / PDF 图标）
//   · 每张缩略图：点击在新标签打开原图；右上角"×"按钮触发解绑
//   · 解绑：调用 governanceStore.openUnbindModal() → 由 UnbindingModal 处理（Task 3 接管）
//
// 该组件是纯"展示+触发"组件，不含上传或删除逻辑

import { useEffect }               from 'react'
import { useState }                from 'react'
import { useGovernanceStore }      from '@/store/governanceStore'
import { subscribeEvidences }      from '@/services/firebase/evidenceService'
import type { Evidence }           from '@/types/Evidence.types'

// ════════════════════════════════════════════════════════════════
// § 1  内部 Hook：实时订阅凭证列表
// ════════════════════════════════════════════════════════════════

interface UseEvidencesReturn {
  evidences: Evidence[]
  isLoading: boolean
}

/**
 * useEvidences — 订阅单条账单的所有凭证（onSnapshot 实时同步）
 * txId 为 null 时直接返回空列表（不发起 Firestore 请求）
 */
function useEvidences(txId: string | null): UseEvidencesReturn {
  const [evidences, setEvidences] = useState<Evidence[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!txId) {
      setEvidences([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const unsub = subscribeEvidences(txId, (items) => {
      setEvidences(items)
      setIsLoading(false)
    })

    return unsub
  }, [txId])

  return { evidences, isLoading }
}

// ════════════════════════════════════════════════════════════════
// § 2  单个凭证缩略图卡片
// ════════════════════════════════════════════════════════════════

interface EvidenceThumbProps {
  evidence:    Evidence
  onUnbind:    (evidence: Evidence) => void
  isUnbinding: boolean   // 当前此张凭证正在执行解绑（禁用交互）
}

function EvidenceThumb({ evidence, onUnbind, isUnbinding }: EvidenceThumbProps) {
  const isImage   = evidence.fileType.startsWith('image/')
  const isPdf     = evidence.fileType === 'application/pdf'
  const isMissing = evidence.status === 'missing'

  // 文件大小格式化（字节 → KB / MB）
  const sizeText = evidence.fileSizeBytes < 1024 * 100
    ? `${Math.round(evidence.fileSizeBytes / 1024)} KB`
    : `${(evidence.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`

  return (
    <div className="relative group flex-shrink-0">

      {/* 主体区域：点击打开原始文件 */}
      <a
        href={isMissing ? undefined : evidence.storageUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`${evidence.fileName}（${sizeText}）`}
        className={[
          'block w-20 h-20 rounded-xl overflow-hidden',
          'border-2 border-border-primary',
          'bg-surface-secondary',
          'transition-all duration-150',
          isMissing
            ? 'cursor-default opacity-60'
            : 'hover:border-primary-400 hover:shadow-md cursor-zoom-in',
        ].join(' ')}
        // 文件缺失时阻止跳转
        onClick={isMissing ? (e) => e.preventDefault() : undefined}
      >
        {/* ─── 图片预览 ─── */}
        {isImage && !isMissing ? (
          <img
            src={evidence.storageUrl}
            alt={evidence.fileName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          // ─── 非图片 / 文件缺失 → 占位图标 ───
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1">
            <span className="text-2xl leading-none">
              {isMissing ? '⚠️' : isPdf ? '📄' : '📁'}
            </span>
            <span className={[
              'text-[9px] font-medium text-center leading-tight break-all',
              isMissing ? 'text-yellow-600' : 'text-content-tertiary',
            ].join(' ')}>
              {isMissing ? '文件缺失' : evidence.fileName.slice(0, 12)}
            </span>
          </div>
        )}
      </a>

      {/* ─── 解绑按钮（右上角，hover 时浮现）─── */}
      <button
        type="button"
        disabled={isUnbinding}
        onClick={() => onUnbind(evidence)}
        title="解绑此凭证"
        className={[
          // 定位：右上角悬浮
          'absolute -top-1.5 -right-1.5 z-10',
          'w-5 h-5 rounded-full',
          'flex items-center justify-center',
          // 外观
          'bg-red-500 text-white text-[10px] font-bold leading-none',
          'border-2 border-white',
          'shadow-sm',
          // 交互
          'transition-all duration-150',
          'opacity-0 group-hover:opacity-100',
          'hover:bg-red-600 active:bg-red-700',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {isUnbinding ? (
          // 解绑中：旋转加载圈
          <span className="w-2.5 h-2.5 border border-white/50 border-t-white rounded-full animate-spin" />
        ) : (
          '×'
        )}
      </button>

    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 3  主组件：EvidenceList
// ════════════════════════════════════════════════════════════════

interface EvidenceListProps {
  /** 关联账单 ID（null = 不加载，用于条件渲染场景）*/
  transactionId: string | null
  /** 可选：组件顶层额外 class */
  className?:    string
}

export default function EvidenceList({ transactionId, className }: EvidenceListProps) {
  const { evidences, isLoading } = useEvidences(transactionId)
  const openUnbindModal          = useGovernanceStore(s => s.openUnbindModal)

  // ── 解绑处理（Task 3：交由 UnbindingModal 统一处理确认 + 删除 + 版本记录）──
  // 本组件只负责打开弹窗，实际删除逻辑由 UnbindingModal → unbindEvidence 完成
  function handleUnbind(ev: Evidence): void {
    openUnbindModal({
      transactionId: ev.transactionId,
      evidenceId:    ev.id,
      evidenceUrl:   ev.status === 'ok' ? ev.storageUrl : undefined,
    })
  }

  // ── 骨架屏 ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={['flex gap-2', className ?? ''].join(' ')}>
        {[1, 2].map(i => (
          <div
            key={i}
            className="w-20 h-20 rounded-xl bg-surface-secondary animate-pulse flex-shrink-0"
          />
        ))}
      </div>
    )
  }

  // ── 空状态 ─────────────────────────────────────────────────────
  if (evidences.length === 0) {
    return (
      <div className={[
        'flex flex-col items-center justify-center gap-1',
        'py-4 rounded-xl',
        'border-2 border-dashed border-border-primary',
        'bg-surface-secondary',
        className ?? '',
      ].join(' ')}>
        <span className="text-2xl">📭</span>
        <p className="text-[11px] text-content-tertiary">暂无凭证</p>
      </div>
    )
  }

  // ── 凭证网格 ────────────────────────────────────────────────────
  return (
    <div className={['space-y-2', className ?? ''].join(' ')}>
      {/* 凭证计数标题 */}
      <p className="text-[11px] text-content-tertiary font-medium">
        已关联 {evidences.length} 张凭证
        {evidences.some(e => e.status === 'missing') && (
          <span className="ml-1.5 text-yellow-600">（含缺失文件）</span>
        )}
      </p>

      {/* 横向滚动缩略图列表 */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {evidences.map((ev) => (
          <EvidenceThumb
            key={ev.id}
            evidence={ev}
            onUnbind={() => handleUnbind(ev)}
            isUnbinding={false}
          />
        ))}
      </div>
    </div>
  )
}
