// 账套全局状态机（Zustand）— S18 实时越权阻断版
//
// S18 核心新增：ejectionInfo 越权阻断状态
//
// 检测逻辑（在 startLedgerListener onSnapshot 回调中）：
//   ┌─ 首次快照（prevLedgers 为空）────────────────────────────────────────
//   │   若 activeLedgerId 不在 myLedgers 中 → 静默切换（无弹窗，可能是
//   │   旧持久化数据失效），切到第一个可用账套
//   └─ 后续快照（prevLedgers 非空，已完成首次加载）──────────────────────
//       若 activeLedgerId 曾在 prevLedgers 中，但已不在 myLedgers 中
//       → 确认为"被踢出"事件：
//         1. 写入 ejectionInfo（含被踢账套 ID + 名称）
//         2. 自动将 activeLedgerId 切到第一个剩余账套（或置空）
//         3. EjectionBlocker 组件检测到 ejectionInfo 后渲染全屏阻断层

import { create }  from 'zustand'
import { persist } from 'zustand/middleware'
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { db }                     from '@/config/firebase'
import { MOCK_DEFAULT_LEDGER_ID } from '@/mock/ledgers.mock'
import type { Ledger }            from '@/types/Ledger.types'

// ── 被踢出事件结构 ─────────────────────────────────────────────
export interface EjectionInfo {
  ledgerId:   string   // 被踢出的账套 ID
  ledgerName: string   // 被踢出的账套名称（供 EjectionBlocker 展示）
  ejectedAt:  number   // 事件时间戳（毫秒）
}

// ── Store 状态接口 ─────────────────────────────────────────────
interface LedgerState {
  activeLedgerId: string
  ledgers:        Ledger[]
  ledgersReady:   boolean

  /**
   * ejectionInfo — 越权阻断事件
   * null  = 正常状态
   * 非null = 用户被某账套踢出，EjectionBlocker 应渲染全屏阻断层
   * 用户点击「我已知晓」后由 clearEjection() 置为 null
   */
  ejectionInfo: EjectionInfo | null

  setActiveLedgerId: (id: string)                  => void
  setLedgers:        (ledgers: Ledger[])             => void
  setLedgersReady:   (ready: boolean)               => void
  setEjectionInfo:   (info: EjectionInfo | null)    => void
  clearEjection:     ()                             => void
}

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set) => ({
      activeLedgerId: MOCK_DEFAULT_LEDGER_ID,
      ledgers:        [],
      ledgersReady:   false,
      ejectionInfo:   null,

      setActiveLedgerId: (id)     => set({ activeLedgerId: id }),
      setLedgers:        (ledgers) => set({ ledgers }),
      setLedgersReady:   (ready)  => set({ ledgersReady: ready }),
      setEjectionInfo:   (info)   => set({ ejectionInfo: info }),
      clearEjection:     ()       => set({ ejectionInfo: null }),
    }),
    {
      name:       'rmmv3-ledger',
      // 只持久化账套 ID，ejectionInfo 不持久化（刷新后重置）
      partialize: (s) => ({ activeLedgerId: s.activeLedgerId }),
    },
  ),
)

// ─────────────────────────────────────────────────────────────
// startLedgerListener — 建立 ledgers 集合实时监听（S18 踢人检测版）
//
// @param uid — 来自 Firebase Auth 的真实用户 UID
// ─────────────────────────────────────────────────────────────
export function startLedgerListener(uid: string): Unsubscribe {
  const store = useLedgerStore.getState()

  // 新监听开始前重置 ready 状态（不清空 ledgers，避免首屏闪烁）
  store.setLedgersReady(false)

  return onSnapshot(
    collection(db, 'ledgers'),
    (snap) => {
      // ── 从 Firestore 快照提取当前用户所属账套 ───────────────
      const allLedgers = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Ledger)
      const myLedgers  = allLedgers.filter(l =>
        l.members?.some(m => m.userId === uid)
      )

      // ── 读取当前 Store 快照（此时 setLedgers 还未调用）──────
      const {
        activeLedgerId,
        ledgers: prevLedgers,
        setLedgers,
        setLedgersReady,
        setActiveLedgerId,
        setEjectionInfo,
      } = useLedgerStore.getState()

      const isFirstSnapshot = prevLedgers.length === 0

      if (isFirstSnapshot) {
        // ── 首次快照：静默恢复 ───────────────────────────────
        // 若持久化的 activeLedgerId 已不在用户账套列表（离线期间被踢）
        // → 静默切换，不弹警告（用户还不知道自己曾在那个账套里）
        const stillValid = myLedgers.some(l => l.id === activeLedgerId)
        if (!stillValid && myLedgers.length > 0) {
          setActiveLedgerId(myLedgers[0].id)
          console.debug(
            `[ledgerStore] 首次快照：activeLedgerId "${activeLedgerId}" 已失效，` +
            `静默切换至 "${myLedgers[0].id}"`
          )
        }
      } else {
        // ── 后续快照：实时踢人检测 ───────────────────────────
        // 判断条件：
        //   1. 用户之前在活跃账套的 members 里（wasInActiveledger）
        //   2. 新快照中该账套的 members 里已没有该用户（removedFromActive）
        const activeInPrev   = prevLedgers.find(l => l.id === activeLedgerId)
        const stillHasMember = myLedgers.some(l => l.id === activeLedgerId)

        if (activeInPrev && !stillHasMember) {
          // ════ 越权事件触发！══════════════════════════════
          const ejectedName = activeInPrev.name

          console.warn(
            `[ledgerStore] 🚨 越权阻断：用户已被移出账套 "${ejectedName}" (${activeLedgerId})`
          )

          // 1. 写入阻断信息 → EjectionBlocker 渲染全屏遮罩
          setEjectionInfo({
            ledgerId:   activeLedgerId,
            ledgerName: ejectedName,
            ejectedAt:  Date.now(),
          })

          // 2. 强制切换到第一个仍有权限的账套（若无则置空）
          const fallback = myLedgers[0]
          setActiveLedgerId(fallback?.id ?? '')
        }
      }

      // ── 更新账套列表并标记就绪 ──────────────────────────────
      setLedgers(myLedgers)
      setLedgersReady(true)

      console.debug(
        `[ledgerStore] 实时同步 ${myLedgers.length}/${allLedgers.length} 个账套` +
        ` (uid: ${uid.slice(0, 8)}…)`
      )
    },
    (err) => {
      console.error('[ledgerStore] 监听错误:', err.message)
    },
  )
}
