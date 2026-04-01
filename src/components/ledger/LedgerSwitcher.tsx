// 账套切换器组件
// 显示当前激活账套，点击展开下拉菜单切换账套
// S7 阶段：当前使用 Mock 数据 + 父组件 React State，S5 接入后改用 ledgerStore

import { useState, useEffect, useRef } from 'react'
import type { Ledger } from '@/types/Ledger.types'
import { MOCK_LEDGERS } from '@/mock/ledgers.mock'

// ── 账套类型的视觉元数据 ──────────────────────────────────────
const LEDGER_TYPE_META: Record<string, { icon: string; label: string; iconBg: string; iconText: string }> = {
  personal:   { icon: '👤', label: '个人',   iconBg: 'bg-primary-50',  iconText: 'text-primary-600' },
  family:     { icon: '🏡', label: '家庭',   iconBg: 'bg-green-50',    iconText: 'text-green-600'   },
  enterprise: { icon: '🏢', label: '企业',   iconBg: 'bg-amber-50',    iconText: 'text-amber-600'   },
}

// ── 货币 → 符号映射 ───────────────────────────────────────────
const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  CAD: 'CA$',
  USD: 'US$',
  HKD: 'HK$',
}

// ── 组件 Props ────────────────────────────────────────────────
interface LedgerSwitcherProps {
  activeLedgerId: string
  onLedgerChange: (ledgerId: string) => void
}

// ── Toast 组件（内联，仅此组件使用）─────────────────────────
interface ToastProps {
  message: string
  visible: boolean
}

function InlineToast({ message, visible }: ToastProps) {
  return (
    <div
      className={`
        fixed top-5 left-1/2 -translate-x-1/2 z-[200]
        flex items-center gap-2 px-4 py-2.5
        bg-gray-900/92 text-white text-sm font-medium
        rounded-full shadow-xl pointer-events-none
        transition-all duration-300
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
      `}
    >
      {/* 成功图标 */}
      <svg className="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
      <span>{message}</span>
    </div>
  )
}

// ── 主组件 ─────────────────────────────────────────────────────
function LedgerSwitcher({ activeLedgerId, onLedgerChange }: LedgerSwitcherProps) {
  // 下拉菜单开关状态
  const [isOpen, setIsOpen]         = useState(false)
  // Toast 消息内容（null = 不显示）
  const [toastMsg, setToastMsg]     = useState<string | null>(null)
  // Toast 可见性（用于 CSS transition）
  const [toastVisible, setToastVisible] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // 当前激活账套数据
  const activeLedger = MOCK_LEDGERS.find(l => l.id === activeLedgerId) ?? MOCK_LEDGERS[0]
  const activeMeta   = LEDGER_TYPE_META[activeLedger.type] ?? LEDGER_TYPE_META.personal

  // ── 点击页面其他区域时关闭下拉 ─────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Toast 显示/消失控制（CSS 两阶段：先渲染再显隐） ────────
  useEffect(() => {
    if (!toastMsg) return
    // 下一帧触发 visible → 触发 transition 进入动画
    const showTimer = requestAnimationFrame(() => setToastVisible(true))
    // 2.2s 后开始退出动画
    const hideTimer = setTimeout(() => setToastVisible(false), 2200)
    // 动画结束后清空消息
    const clearTimer = setTimeout(() => setToastMsg(null), 2600)
    return () => {
      cancelAnimationFrame(showTimer)
      clearTimeout(hideTimer)
      clearTimeout(clearTimer)
    }
  }, [toastMsg])

  // ── 选择账套 ──────────────────────────────────────────────
  function handleSelect(ledger: Ledger) {
    setIsOpen(false)
    if (ledger.id === activeLedgerId) return
    onLedgerChange(ledger.id)
    // 重置后再赋值，使同账套重复切换也能重新触发 Toast
    setToastMsg(null)
    setToastVisible(false)
    requestAnimationFrame(() => setToastMsg(`已切换至「${ledger.name}」`))
  }

  return (
    <>
      {/* ── Toast 提示（固定居顶） ─────────────────────────── */}
      {toastMsg && (
        <InlineToast message={toastMsg} visible={toastVisible} />
      )}

      {/* ── 触发器 + 下拉容器（relative 定位锚点） ─────────── */}
      <div ref={containerRef} className="relative">

        {/* 触发按钮 */}
        <button
          onClick={() => setIsOpen(v => !v)}
          className="flex items-center gap-2.5 group active:opacity-80 transition-opacity"
          aria-label="切换账套"
          aria-expanded={isOpen}
        >
          {/* 账套类型图标圆角块 */}
          <div className={`
            w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0
            ${activeMeta.iconBg} ${activeMeta.iconText}
            transition-transform group-active:scale-95
          `}>
            {activeMeta.icon}
          </div>

          {/* 账套名 + 副标题 */}
          <div className="text-left">
            <div className="flex items-center gap-1">
              <h1 className="text-[15px] font-bold text-content-primary leading-tight">
                {activeLedger.name}
              </h1>
              {/* 展开/收起箭头 */}
              <svg
                className={`w-3.5 h-3.5 text-content-tertiary transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {/* 货币 + 账套类型 */}
            <p className="text-[11px] text-content-tertiary leading-tight">
              {CURRENCY_SYMBOL[activeLedger.currency] ?? activeLedger.currency}
              &nbsp;·&nbsp;{activeMeta.label}账套
            </p>
          </div>
        </button>

        {/* ── 下拉菜单 ──────────────────────────────────────── */}
        {isOpen && (
          <div className="
            absolute top-full left-0 mt-2.5 w-72
            bg-white rounded-2xl border border-border
            shadow-[0_8px_32px_rgba(0,0,0,0.12)]
            z-50 overflow-hidden
          ">
            {/* 菜单头部 */}
            <div className="px-4 py-3 border-b border-border-light bg-surface-overlay/50">
              <p className="text-[11px] font-semibold text-content-tertiary tracking-widest uppercase">
                我的账套
              </p>
            </div>

            {/* 账套选项列表 */}
            <div className="py-1.5">
              {MOCK_LEDGERS.map(ledger => {
                const meta     = LEDGER_TYPE_META[ledger.type] ?? LEDGER_TYPE_META.personal
                const isActive = ledger.id === activeLedgerId
                const symbol   = CURRENCY_SYMBOL[ledger.currency] ?? ledger.currency

                return (
                  <button
                    key={ledger.id}
                    onClick={() => handleSelect(ledger)}
                    className={`
                      w-full px-4 py-3 flex items-center gap-3 text-left
                      transition-colors duration-100
                      ${isActive ? 'bg-primary-50' : 'hover:bg-surface-overlay'}
                    `}
                  >
                    {/* 类型图标 */}
                    <div className={`
                      w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0
                      ${meta.iconBg} ${meta.iconText}
                    `}>
                      {meta.icon}
                    </div>

                    {/* 名称 + 描述 */}
                    <div className="flex-1 min-w-0">
                      <p className={`
                        text-sm font-semibold leading-tight
                        ${isActive ? 'text-primary-600' : 'text-content-primary'}
                      `}>
                        {ledger.name}
                      </p>
                      <p className="text-xs text-content-tertiary mt-0.5 truncate">
                        {ledger.description}
                      </p>
                    </div>

                    {/* 右侧：货币 + 勾选 */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[11px] font-mono font-medium text-content-tertiary bg-surface-overlay px-1.5 py-0.5 rounded">
                        {symbol}
                      </span>
                      {/* 已选中标记 */}
                      {isActive && (
                        <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 菜单底部：管理账套入口（S7 完成后激活） */}
            <div className="px-4 py-3 border-t border-border-light">
              <button className="
                w-full flex items-center justify-center gap-1.5
                text-xs text-content-tertiary hover:text-primary-600
                transition-colors py-1
              ">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>管理账套</span>
                <span className="ml-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded text-[10px] font-bold">S7</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default LedgerSwitcher
