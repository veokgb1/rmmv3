// 账套全局状态机（Zustand）
// 管理"当前激活账套"，是所有账套相关 UI 和数据筛选的唯一数据源
// S5 接入 Firestore 后，ledgers 列表由 ledgerService.fetchAll() 替换

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MOCK_LEDGERS, MOCK_DEFAULT_LEDGER_ID } from '@/mock/ledgers.mock'
import type { Ledger } from '@/types/Ledger.types'

// ── Store 状态接口 ─────────────────────────────────────────────
interface LedgerState {
  /** 当前激活的账套 ID（所有账单查询的第一过滤条件） */
  activeLedgerId: string

  /** 当前用户可访问的账套列表（S5 后由 Firestore 查询填充） */
  ledgers: Ledger[]

  // ── Actions ─────────────────────────────────────────────────
  /** 切换当前账套 */
  setActiveLedgerId: (id: string) => void

  /** S5 接入后：从 Firestore 同步账套列表（目前为 Mock） */
  setLedgers: (ledgers: Ledger[]) => void
}

// ── Store 实例 ─────────────────────────────────────────────────
// persist 中间件：将 activeLedgerId 持久化到 localStorage
// 用户刷新页面后不会丢失上次选择的账套
export const useLedgerStore = create<LedgerState>()(
  persist(
    (set) => ({
      activeLedgerId: MOCK_DEFAULT_LEDGER_ID,
      ledgers:        MOCK_LEDGERS,

      setActiveLedgerId: (id) => set({ activeLedgerId: id }),
      setLedgers:        (ledgers) => set({ ledgers }),
    }),
    {
      name:    'rmmv3-ledger',   // localStorage key
      // 只持久化 activeLedgerId，ledgers 列表每次从服务端/Mock 重新加载
      partialize: (state) => ({ activeLedgerId: state.activeLedgerId }),
    },
  ),
)
