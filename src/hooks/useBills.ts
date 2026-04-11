// useBills — 账单数据业务 Hook (S5 Firebase 实时版)
// 订阅当前激活账套，返回过滤后账单、统计数据、纠偏入口
// 核心安全保证：向 UI 层只暴露当前账套内的数据，永远不会越界
//
// S5 变更：
//   - billsReady 状态透传给 UI 层（区分"加载中"与"空数据"）
//   - correct() 在乐观更新本地 Store 后，异步写入 Firestore
//     onSnapshot 回调确认后完成最终一致性（双写策略）

import { useMemo }  from 'react'
import { useBillStore }     from '@/store/billStore'
import { useLedgerStore }   from '@/store/ledgerStore'
import { handleCorrection } from '@/services/correctionService'
import {
  updateTransaction,
  batchUpdateTransactions,
  deleteTransaction,
}                           from '@/services/firebase/billService'
import type { Transaction, CorrectionPolicy, CorrectionIntent } from '@/types/Transaction.types'

// ── 当月前缀计算（函数，每次调用时按实时时钟计算，避免跨月缓存问题）
function getThisMonthPrefix(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ── Hook 返回值接口 ─────────────────────────────────────────────
export interface UseBillsReturn {
  thisMonthBills: Transaction[]
  allLedgerBills: Transaction[]
  income:         number
  expense:        number
  net:            number
  totalCount:     number
  /** Firestore 首次快照是否已到达（false = 骨架屏，true = 真实数据） */
  billsReady:     boolean
  /**
   * 纠偏：乐观更新本地 Store + 异步写入 Firestore
   * @returns matchedCount — 实际受影响的账单条数（溯及既往时 > 1）
   */
  correct:        (policy: CorrectionPolicy, intent: CorrectionIntent) => Promise<number>
  /**
   * 删除单条账单：仅调用 Firestore deleteDoc，绝不手动改 Store
   * onSnapshot 收到变更后账单自动从列表消失
   */
  deleteOne:      (id: string) => Promise<void>
}

export function useBills(): UseBillsReturn {
  const activeLedgerId  = useLedgerStore(s => s.activeLedgerId)
  const allTransactions = useBillStore(s => s._allTransactions)
  const billsReady      = useBillStore(s => s.billsReady)
  const updateOne       = useBillStore(s => s.updateOne)
  const batchUpdate     = useBillStore(s => s.batchUpdate)

  // ── S5 说明：billStore 已由 onSnapshot 按账套过滤写入 ─────────
  // _allTransactions 已经是当前账套的数据（startBillsListener 查询时带了 WHERE ledgerId）
  // 但保留此过滤作为防御性编程（防止监听竞态期间旧账套数据短暂残留）
  const allLedgerBills = useMemo(() => (
    allTransactions
      .filter(t => t.ledgerId === activeLedgerId)
      .sort((a, b) => a.date.localeCompare(b.date))
  ), [allTransactions, activeLedgerId])

  const thisMonthBills = useMemo(() => {
    const prefix = getThisMonthPrefix()
    return allLedgerBills
      .filter(t => t.date.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [allLedgerBills])

  const income = useMemo(() => (
    thisMonthBills.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  ), [thisMonthBills])

  const expense = useMemo(() => (
    thisMonthBills
      .filter(t => t.amount < 0 && t.category !== '转账')
      .reduce((s, t) => s + Math.abs(t.amount), 0)
  ), [thisMonthBills])

  // ── 纠偏操作：乐观更新 + await Firestore 写入 ──────────────────
  // 返回 matchedCount 供上层（HomePage）展示 Toast 计数
  const correct = async (
    policy: CorrectionPolicy,
    intent: CorrectionIntent,
  ): Promise<number> => {
    const result = handleCorrection(policy, intent, allTransactions, activeLedgerId)
    const patch  = result.patch as Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>

    if (result.updatedIds.length === 1) {
      // 乐观更新本地 Store（立即刷新 UI）
      updateOne(result.updatedIds[0], patch)
      // 等待 Firestore 写入（调用方依此驱动 Loading 态）
      await updateTransaction(result.updatedIds[0], patch)
    } else {
      // 批量：乐观先更本地，再 await writeBatch
      batchUpdate(result.updatedIds, patch)
      await batchUpdateTransactions(result.updatedIds, patch)
    }

    console.info(
      `[useBills·correct] 策略=${policy} 账套=${activeLedgerId}`,
      `已同步 ${result.matchedCount} 条到 Firestore`,
      result.rule ? `规则已创建: ${result.rule.id}` : '',
    )

    // onSnapshot 会随后确认最终一致，无需手动 re-pull
    return result.matchedCount
  }

  // ── 删除单条账单：仅调用 Firestore，不触碰本地 Store ────────────
  // 删除完成后 onSnapshot 会从 _allTransactions 中移除该条 → UI 自动消失
  const deleteOne = async (id: string): Promise<void> => {
    await deleteTransaction(id)
    console.info(`[useBills·deleteOne] 账套=${activeLedgerId} 账单=${id} 已删除`)
  }

  return {
    thisMonthBills,
    allLedgerBills,
    income,
    expense,
    net: income - expense,
    totalCount: thisMonthBills.length,
    billsReady,
    correct,
    deleteOne,
  }
}
