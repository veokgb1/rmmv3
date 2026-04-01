// useBills — 账单数据业务 Hook
// 自动订阅当前激活账套，返回过滤后的账单列表及衍生统计数据
// 核心安全保证：向 UI 层只暴露当前账套内的数据，永远不会越界

import { useMemo } from 'react'
import { useBillStore }   from '@/store/billStore'
import { useLedgerStore } from '@/store/ledgerStore'
import { handleCorrection } from '@/services/correctionService'
import type { Transaction, CorrectionPolicy, CorrectionIntent } from '@/types/Transaction.types'

// ── 当月前缀计算（运行时固定，不放在渲染循环中重复计算） ──────
const now = new Date()
const THIS_MONTH_PREFIX = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

// ── Hook 返回值接口 ─────────────────────────────────────────────
export interface UseBillsReturn {
  /** 当前账套本月账单（日期倒序） */
  thisMonthBills: Transaction[]
  /** 当前账套本月收入合计 */
  income:  number
  /** 当前账套本月支出合计（绝对值，已排除"转账"分类） */
  expense: number
  /** 本月净收支 = income - expense */
  net:     number
  /** 当前账套本月账单总条数 */
  totalCount: number

  /**
   * correct — 执行纠偏操作（三种策略的统一入口）
   *
   * 安全保证：scopeLedgerId 由 Hook 内部从 Store 读取，
   * 调用方（HomePage 等）无需传入，避免 UI 层传错账套 ID。
   *
   * @param policy  CorrectionPolicyModal 用户选择的策略
   * @param intent  修改意图（字段、旧值、新值、目标账单 ID）
   */
  correct: (policy: CorrectionPolicy, intent: CorrectionIntent) => void
}

export function useBills(): UseBillsReturn {
  // 从 Store 订阅（Zustand 自动处理浅比较，只在依赖变化时重渲染）
  const activeLedgerId    = useLedgerStore(s => s.activeLedgerId)
  const allTransactions   = useBillStore(s => s._allTransactions)
  const updateOne         = useBillStore(s => s.updateOne)
  const batchUpdate       = useBillStore(s => s.batchUpdate)

  // ── 核心过滤：当前账套 + 本月 ──────────────────────────────
  // 🔒 ledgerId 过滤是向 UI 层的数据隔离防火墙
  const thisMonthBills = useMemo(() => (
    allTransactions
      .filter(t =>
        t.ledgerId === activeLedgerId &&      // 🔒 账套隔离
        t.date.startsWith(THIS_MONTH_PREFIX)  // 本月过滤
      )
      .sort((a, b) => b.date.localeCompare(a.date))  // 日期倒序
  ), [allTransactions, activeLedgerId])

  // ── 收入统计 ───────────────────────────────────────────────
  const income = useMemo(() => (
    thisMonthBills
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0)
  ), [thisMonthBills])

  // ── 支出统计（排除转账） ───────────────────────────────────
  const expense = useMemo(() => (
    thisMonthBills
      .filter(t => t.amount < 0 && t.category !== '转账')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
  ), [thisMonthBills])

  // ── 纠偏操作（在账套作用域内执行）──────────────────────────
  const correct = (policy: CorrectionPolicy, intent: CorrectionIntent) => {
    // 调用纠偏引擎（传入当前账套 ID 作为安全边界）
    const result = handleCorrection(
      policy,
      intent,
      allTransactions,
      activeLedgerId,  // 🔒 Hook 内部注入，UI 层无法篡改
    )

    // 根据返回的 updatedIds 数量选择单条或批量写入
    if (result.updatedIds.length === 1) {
      updateOne(result.updatedIds[0], result.patch as Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>)
    } else {
      batchUpdate(result.updatedIds, result.patch as Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>)
    }

    // 开发调试：打印纠偏结果摘要
    console.info(
      `[useBills·correct] 策略=${policy} 账套=${activeLedgerId}`,
      `更新 ${result.matchedCount} 条`,
      result.rule ? `规则已创建: ${result.rule.id}` : ''
    )
  }

  return {
    thisMonthBills,
    income,
    expense,
    net: income - expense,
    totalCount: thisMonthBills.length,
    correct,
  }
}
