// useLedger — 账套切换业务 Hook (S5 实时版)
// 封装 ledgerStore，提供"切换账套 + 获取当前账套元数据"的统一接口

import { useLedgerStore } from '@/store/ledgerStore'
import type { Ledger }    from '@/types/Ledger.types'

export interface UseLedgerReturn {
  activeLedgerId: string
  activeLedger:   Ledger | undefined
  ledgers:        Ledger[]
  /** Firestore ledgers 集合首次快照是否已到达 */
  ledgersReady:   boolean
  switchLedger:   (id: string) => void
}

export function useLedger(): UseLedgerReturn {
  const activeLedgerId    = useLedgerStore(s => s.activeLedgerId)
  const ledgers           = useLedgerStore(s => s.ledgers)
  const ledgersReady      = useLedgerStore(s => s.ledgersReady)
  const setActiveLedgerId = useLedgerStore(s => s.setActiveLedgerId)

  const activeLedger = ledgers.find(l => l.id === activeLedgerId)

  return {
    activeLedgerId,
    activeLedger,
    ledgers,
    ledgersReady,
    switchLedger: setActiveLedgerId,
  }
}
