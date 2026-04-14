// governanceStore — 治理模块全局 UI 状态（Zustand）
// 管理凭证上传器、解绑确认弹窗、冲突详情面板三个全局 Modal 的开关状态
//
// 设计原则：
//   · 不使用 persist（治理状态为临时 UI 状态，刷新后应重置）
//   · selectedConflictId 驱动冲突中心的详情面板展开/收起
//   · evidenceUploadTargetId / unbindTarget 供 Task 2 凭证模块使用（预留接口）

import { create } from 'zustand'

// ── 解绑凭证操作目标 ─────────────────────────────────────────────
export interface UnbindTarget {
  /** 关联账单 ID */
  transactionId: string
  /** 要解绑的凭证 ID */
  evidenceId:    string
  /** 可选：凭证预览 URL（供确认弹窗展示缩略图）*/
  evidenceUrl?:  string
  /**
   * onSuccess — 解绑/硬删成功后的回调
   * 调用方可以在此 push Toast 或触发本地状态刷新
   * 不传则静默关闭
   */
  onSuccess?: (action: 'unbound' | 'deleted') => void
}

// ── Store 状态接口 ─────────────────────────────────────────────
interface GovernanceState {
  /**
   * evidenceUploadTargetId — 凭证上传器当前绑定的账单 ID
   * null = 上传器关闭
   * 非null = 上传器已打开，正在为该账单上传凭证
   */
  evidenceUploadTargetId: string | null

  /**
   * unbindTarget — 解绑凭证弹窗的操作目标
   * null = 弹窗关闭
   */
  unbindTarget: UnbindTarget | null

  /**
   * selectedConflictId — 冲突中心当前选中展开的账单 ID
   * null = 无选中（详情面板收起）
   */
  selectedConflictId: string | null

  // ── Actions ────────────────────────────────────────────────

  /** 打开凭证上传器，绑定目标账单 */
  openEvidenceUploader:  (txId: string)       => void
  /** 关闭凭证上传器 */
  closeEvidenceUploader: ()                   => void

  /** 打开解绑凭证确认弹窗 */
  openUnbindModal:       (target: UnbindTarget) => void
  /** 关闭解绑凭证确认弹窗 */
  closeUnbindModal:      ()                     => void

  /**
   * selectConflict — 切换冲突中心详情面板
   * @param txId null = 收起所有详情面板
   */
  selectConflict: (txId: string | null) => void
}

// ── Store 实例 ─────────────────────────────────────────────────
export const useGovernanceStore = create<GovernanceState>()((set) => ({
  evidenceUploadTargetId: null,
  unbindTarget:           null,
  selectedConflictId:     null,

  openEvidenceUploader:  (txId)   => set({ evidenceUploadTargetId: txId }),
  closeEvidenceUploader: ()       => set({ evidenceUploadTargetId: null }),

  openUnbindModal:  (target) => set({ unbindTarget: target }),
  closeUnbindModal: ()       => set({ unbindTarget: null }),

  selectConflict: (txId) => set({ selectedConflictId: txId }),
}))
