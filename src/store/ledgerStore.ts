// 账套全局状态机（Zustand）— S5 Firebase 实时版
// onSnapshot 订阅 ledgers 集合，账套变更自动推送到所有订阅组件
// activeLedgerId 持久化到 localStorage；ledgers 列表每次从 Firestore 实时同步

import { create }  from 'zustand'
import { persist } from 'zustand/middleware'
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { db }                     from '@/config/firebase'
import { MOCK_DEFAULT_LEDGER_ID } from '@/mock/ledgers.mock'
import type { Ledger }            from '@/types/Ledger.types'

// ── Store 状态接口 ─────────────────────────────────────────────
interface LedgerState {
  /** 当前激活的账套 ID（所有账单查询的第一过滤条件） */
  activeLedgerId: string

  /** 来自 Firestore 的账套列表（实时同步） */
  ledgers: Ledger[]

  /** Firestore 首次快照是否已到达（区分"加载中"与"空数据"） */
  ledgersReady: boolean

  setActiveLedgerId: (id: string)      => void
  setLedgers:        (ledgers: Ledger[]) => void
  setLedgersReady:   (ready: boolean)  => void
}

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set) => ({
      activeLedgerId: MOCK_DEFAULT_LEDGER_ID,
      ledgers:        [],
      ledgersReady:   false,

      setActiveLedgerId: (id)      => set({ activeLedgerId: id }),
      setLedgers:        (ledgers) => set({ ledgers }),
      setLedgersReady:   (ready)   => set({ ledgersReady: ready }),
    }),
    {
      name:       'rmmv3-ledger',
      // 只持久化账套 ID，列表每次从 Firestore 实时拉取
      partialize: (s) => ({ activeLedgerId: s.activeLedgerId }),
    },
  ),
)

// ─────────────────────────────────────────────────────────────
// startLedgerListener — 建立 ledgers 集合实时监听
//
// 设计：放在 Store 模块作为独立函数，而非 Store 内部 action，
// 原因：unsubscribe 是函数类型，Zustand persist 无法 JSON 序列化它
//
// 调用方：App.tsx 挂载时调用一次，返回的 unsubscribe 在卸载时执行
// ─────────────────────────────────────────────────────────────
export function startLedgerListener(): Unsubscribe {
  const { setLedgers, setLedgersReady } = useLedgerStore.getState()

  return onSnapshot(
    collection(db, 'ledgers'),
    (snap) => {
      const ledgers = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Ledger)
      setLedgers(ledgers)
      setLedgersReady(true)
      console.debug(`[ledgerStore] 实时同步 ${ledgers.length} 个账套`)
    },
    (err) => {
      console.error('[ledgerStore] 监听错误:', err.message)
      // 保持 ledgersReady=false，UI 显示错误占位
    },
  )
}
