// EvidenceUploader — 凭证补传触发按钮 (S21)
//
// 职责单一：调用 governanceStore.openEvidenceUploader(txId)，
// 将目标账单 ID 写入全局 Store，触发 EvidenceUploaderModal 展开。
//
// 本组件不含任何上传逻辑，可嵌入到任意需要"补传凭证"入口的位置：
//   · ConflictDetailPane（治理中心详情面板）
//   · 账单详情卡片（未来 Task 3 集成）
//   · 查询页账单行内操作（未来）

import { useGovernanceStore } from '@/store/governanceStore'

// ── Props ─────────────────────────────────────────────────────
interface EvidenceUploaderProps {
  /** 目标账单 Firestore 文档 ID（写入 governanceStore 后传入 Modal）*/
  transactionId: string
  /** 可选：追加 CSS class（用于宿主组件自定义布局）*/
  className?:    string
  /** 可选：按钮文字（默认「补传凭证」）*/
  label?:        string
  /** 可选：禁用按钮（如当前账单已作废）*/
  disabled?:     boolean
}

// ── 主组件 ─────────────────────────────────────────────────────
export default function EvidenceUploader({
  transactionId,
  className,
  label    = '补传凭证',
  disabled = false,
}: EvidenceUploaderProps) {
  const openEvidenceUploader = useGovernanceStore(s => s.openEvidenceUploader)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => openEvidenceUploader(transactionId)}
      className={[
        // 基础外观：蓝色描边小按钮
        'inline-flex items-center gap-1.5',
        'px-3 py-1.5 rounded-lg',
        'text-xs font-medium',
        'border border-blue-300 text-blue-600',
        'bg-transparent',
        'transition-colors duration-150',
        // 交互状态
        'hover:bg-blue-50 active:bg-blue-100',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        // 宿主自定义
        className ?? '',
      ].join(' ')}
    >
      {/* 回形针图标（语义：附件）*/}
      <span className="text-sm leading-none" aria-hidden>📎</span>
      <span>{label}</span>
    </button>
  )
}
