// useFirestoreSync — Firestore 实时监听生命周期管理 Hook
//
// 职责：
//   1. App 挂载时启动 ledgers 集合监听（一次，全局）
//   2. activeLedgerId 变化时切换 transactions 监听（取消旧的，建立新的）
//   3. App 卸载时清理所有监听（防止内存泄漏）
//
// 使用方式：在 App.tsx 中调用一次 useFirestoreSync()，无需任何参数
// 此 Hook 没有返回值，副作用完全透明

import { useEffect, useRef } from 'react'
import type { Unsubscribe }  from 'firebase/firestore'
import { useLedgerStore, startLedgerListener } from '@/store/ledgerStore'
import { startBillsListener }                   from '@/store/billStore'

export function useFirestoreSync(): void {
  const activeLedgerId = useLedgerStore(s => s.activeLedgerId)

  // ref 存储 unsubscribe 函数，不触发重渲染
  const ledgerUnsub = useRef<Unsubscribe | null>(null)
  const billsUnsub  = useRef<Unsubscribe | null>(null)

  // ── 步骤 1：App 挂载时启动 ledgers 监听（只建一次）──────────
  useEffect(() => {
    ledgerUnsub.current = startLedgerListener()
    return () => {
      ledgerUnsub.current?.()
      ledgerUnsub.current = null
    }
  }, [])  // 空依赖 = 只在 App 挂载/卸载时执行

  // ── 步骤 2：activeLedgerId 变化时切换 transactions 监听 ─────
  useEffect(() => {
    if (!activeLedgerId) return

    // 取消上一个账套的监听
    billsUnsub.current?.()

    // 建立新账套的监听
    billsUnsub.current = startBillsListener(activeLedgerId)

    return () => {
      billsUnsub.current?.()
      billsUnsub.current = null
    }
  }, [activeLedgerId])  // 账套切换时重新订阅
}
