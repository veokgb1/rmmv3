// useFirestoreSync — Firestore 实时监听生命周期管理 Hook (S16 Auth 版)
//
// 职责：
//   1. App 挂载时启动 ledgers 集合监听，传入真实 uid 过滤用户账套
//   2. activeLedgerId 变化时切换 transactions 监听（取消旧的，建立新的）
//   3. App 卸载时清理所有监听（防止内存泄漏）
//
// S16 变更：
//   - 获取 useAuthStore 中的真实 user.uid
//   - 将 uid 传给 startLedgerListener，按成员关系过滤账套
//   - 此 Hook 仅在 MainApp（已登录）中挂载，uid 必定有效
//
// 使用方式：在 MainApp 中调用一次 useFirestoreSync()，无需任何参数

import { useEffect, useRef } from 'react'
import type { Unsubscribe }  from 'firebase/firestore'
import { useLedgerStore, startLedgerListener } from '@/store/ledgerStore'
import { startBillsListener }                   from '@/store/billStore'
import { useAuthStore }                         from '@/store/authStore'

export function useFirestoreSync(): void {
  const activeLedgerId = useLedgerStore(s => s.activeLedgerId)
  // 直接从 authStore 读取真实 uid（此 Hook 挂载时 user 必定不为 null）
  const uid = useAuthStore(s => s.user!.uid)

  const ledgerUnsub = useRef<Unsubscribe | null>(null)
  const billsUnsub  = useRef<Unsubscribe | null>(null)

  // ── 步骤 1：挂载时启动 ledgers 监听，传入 uid 过滤用户账套 ──
  useEffect(() => {
    ledgerUnsub.current = startLedgerListener(uid)
    return () => {
      ledgerUnsub.current?.()
      ledgerUnsub.current = null
    }
  }, [uid])  // uid 理论上不会变（同一次登录），但作为依赖保证正确性

  // ── 步骤 2：activeLedgerId 变化时切换 transactions 监听 ─────
  useEffect(() => {
    if (!activeLedgerId) return

    billsUnsub.current?.()
    billsUnsub.current = startBillsListener(activeLedgerId)

    return () => {
      billsUnsub.current?.()
      billsUnsub.current = null
    }
  }, [activeLedgerId])
}
