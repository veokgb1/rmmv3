// 账单全局状态层（Zustand）— S5 Firebase 实时版
// onSnapshot 订阅当前账套的 transactions，切换账套时自动重新订阅
// 乐观更新：本地 store 立即修改，再异步写入 Firestore（onSnapshot 确认回显）

import { create } from 'zustand'
import {
  collection, query, where,
  onSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/config/firebase'
import type { Transaction } from '@/types/Transaction.types'

// ── Store 状态接口 ─────────────────────────────────────────────
interface BillState {
  /**
   * 全量账单（当前监听的账套范围内）
   * 由 onSnapshot 直接写入，不再按账套手动过滤
   *
   * 架构变更说明（S5）：
   *   旧版：存储所有账套账单，useBills 按 ledgerId 过滤
   *   新版：onSnapshot 监听单一账套，_allTransactions 只含当前账套数据
   *   迁移理由：Firestore 查询天然带 ledgerId 过滤，无需在前端做二次过滤
   *             多账套切换时重建监听，数据更干净，内存占用更少
   */
  _allTransactions: Transaction[]

  /** Firestore 首次快照是否已到达 */
  billsReady: boolean

  /** 当前正在监听的账套 ID（防止重复订阅） */
  _listeningLedgerId: string | null

  setTransactions:     (txs: Transaction[]) => void
  setBillsReady:       (ready: boolean)     => void
  setListeningLedgerId:(id: string | null)  => void

  // ── 乐观更新 Actions（本地立即生效，Firestore 异步确认） ──

  /**
   * updateOne — 乐观修改单条账单
   * 调用方须同时调用 billService.updateTransaction() 持久化到 Firestore
   */
  updateOne: (id: string, patch: Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>) => void

  /**
   * batchUpdate — 乐观批量修改（溯及既往）
   * 调用方须同时调用 billService.batchUpdateTransactions() 持久化到 Firestore
   */
  batchUpdate: (ids: string[], patch: Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>) => void

  /**
   * appendTransactions — 追加账单（ImportModal 确认后）
   * 此时账单已由 dbSync/billService 写入 Firestore，
   * onSnapshot 会自动推送新数据，此 action 可选（作为即时本地反馈）
   */
  appendTransactions: (txs: Transaction[]) => void
}

// ── Store 实例 ─────────────────────────────────────────────────
export const useBillStore = create<BillState>()((set) => ({
  _allTransactions:    [],
  billsReady:          false,
  _listeningLedgerId:  null,

  setTransactions:      (txs)   => set({ _allTransactions: txs }),
  setBillsReady:        (ready) => set({ billsReady: ready }),
  setListeningLedgerId: (id)    => set({ _listeningLedgerId: id }),

  updateOne: (id, patch) =>
    set(state => ({
      _allTransactions: state._allTransactions.map(t =>
        t.id === id
          ? { ...t, ...patch, updatedAt: Date.now(), isManuallyEdited: true }
          : t
      ),
    })),

  batchUpdate: (ids, patch) =>
    set(state => ({
      _allTransactions: state._allTransactions.map(t =>
        ids.includes(t.id)
          ? { ...t, ...patch, updatedAt: Date.now(), isManuallyEdited: true }
          : t
      ),
    })),

  appendTransactions: (txs) =>
    set(state => ({
      _allTransactions: [...state._allTransactions, ...txs],
    })),
}))

// ─────────────────────────────────────────────────────────────
// startBillsListener — 建立 transactions 集合实时监听
//
// 每次切换账套时调用：先 unsubscribe 旧监听，再建立新监听
// 返回 unsubscribe 函数，调用方（useLedger hook 或 App.tsx）负责管理生命周期
//
// Firestore 查询：WHERE ledgerId == activeLedgerId（已命中复合索引）
// ─────────────────────────────────────────────────────────────
export function startBillsListener(ledgerId: string): Unsubscribe {
  const { setTransactions, setBillsReady, setListeningLedgerId } =
    useBillStore.getState()

  // 新账套开始订阅前，先标记为 loading
  setBillsReady(false)
  setListeningLedgerId(ledgerId)

  const q = query(
    collection(db, 'transactions'),
    where('ledgerId', '==', ledgerId),
  )

  return onSnapshot(
    q,
    (snap) => {
      // 确认快照仍属于当前监听的账套（防止切换过快时的竞态）
      const currentLedgerId = useBillStore.getState()._listeningLedgerId
      if (currentLedgerId !== ledgerId) return

      const txs = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Transaction)
      setTransactions(txs)
      setBillsReady(true)
      console.debug(`[billStore] 实时同步 ${txs.length} 条账单 (${ledgerId})`)
    },
    (err) => {
      console.error(`[billStore] 监听错误 (${ledgerId}):`, err.message)
    },
  )
}
