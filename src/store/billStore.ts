// 账单全局状态层（Zustand）
// 维护全量账单数组（含所有账套），通过 ledgerId 字段进行逻辑隔离
// 对外不直接暴露，由 useBills Hook 封装过滤逻辑后供组件使用

import { create } from 'zustand'
import { MOCK_TRANSACTIONS } from '@/mock/transactions.mock'
import type { Transaction } from '@/types/Transaction.types'

// ── Store 状态接口 ─────────────────────────────────────────────
interface BillState {
  /**
   * 全量账单（含所有账套）
   * 查询时必须用 ledgerId 过滤，不得对外直接暴露未过滤的全量数组
   * （防止跨账套数据泄漏给 UI 层）
   */
  _allTransactions: Transaction[]

  // ── Actions ─────────────────────────────────────────────────

  /**
   * updateOne — 修改单条账单
   * 自动注入 updatedAt 时间戳和 isManuallyEdited 标记
   *
   * @param id    目标账单 ID
   * @param patch 需要修改的字段（不允许修改 ledgerId / userId / id）
   */
  updateOne: (id: string, patch: Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>) => void

  /**
   * batchUpdate — 批量修改多条账单（用于溯及既往纠偏）
   *
   * 安全保证：此 action 本身不校验 ledgerId，
   * 调用方（correctionService + useBills）负责确保 ids 均属于同一账套。
   *
   * @param ids   目标账单 ID 数组
   * @param patch 需要修改的字段
   */
  batchUpdate: (ids: string[], patch: Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>) => void

  /**
   * appendTransactions — 导入新账单（ImportModal 确认后调用）
   * S5 接入 Firestore 后，此 action 同时写入云端
   *
   * 数据血缘支持：
   *   传入 clonedFromId + sourceLedgerId 可标记账单为跨账套克隆副本，
   *   从而在 UI 层展示血缘来源标签（SX 阶段完整实现）
   */
  appendTransactions: (txs: Transaction[]) => void
}

// ── Store 实例 ─────────────────────────────────────────────────
export const useBillStore = create<BillState>()((set) => ({
  _allTransactions: MOCK_TRANSACTIONS,

  // 单条修改
  updateOne: (id, patch) =>
    set(state => ({
      _allTransactions: state._allTransactions.map(t =>
        t.id === id
          ? { ...t, ...patch, updatedAt: Date.now(), isManuallyEdited: true }
          : t
      ),
    })),

  // 批量修改（溯及既往）
  batchUpdate: (ids, patch) =>
    set(state => ({
      _allTransactions: state._allTransactions.map(t =>
        ids.includes(t.id)
          ? { ...t, ...patch, updatedAt: Date.now(), isManuallyEdited: true }
          : t
      ),
    })),

  // 追加账单
  appendTransactions: (txs) =>
    set(state => ({
      _allTransactions: [...state._allTransactions, ...txs],
    })),
}))
