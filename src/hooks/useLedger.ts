// useLedger — 账套切换业务 Hook
// 封装 ledgerStore，提供"切换账套 + 获取当前账套元数据"的统一接口
// S5 接入 Firestore 后，只需在此 Hook 内替换数据来源，组件层无需修改

import { useLedgerStore } from '@/store/ledgerStore'
import type { Ledger } from '@/types/Ledger.types'

export interface UseLedgerReturn {
  /** 当前激活账套 ID */
  activeLedgerId: string
  /** 当前激活账套的完整数据对象（undefined = 加载中或数据异常） */
  activeLedger:   Ledger | undefined
  /** 所有可访问的账套列表 */
  ledgers:        Ledger[]
  /** 切换账套（自动更新 Store，UI 层会级联响应） */
  switchLedger:   (id: string) => void
}

export function useLedger(): UseLedgerReturn {
  const activeLedgerId   = useLedgerStore(s => s.activeLedgerId)
  const ledgers          = useLedgerStore(s => s.ledgers)
  const setActiveLedgerId = useLedgerStore(s => s.setActiveLedgerId)

  const activeLedger = ledgers.find(l => l.id === activeLedgerId)

  return {
    activeLedgerId,
    activeLedger,
    ledgers,
    switchLedger: setActiveLedgerId,
  }
}
