// 核心数据卡片组 — S6 统计看板顶部三件套
// 展示：本月总收入 / 总支出 / 净结余
// 严格 props-driven：数据来自 useBills()，账套切换时父组件重传 props 即触发重渲染

import type { ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────
// 货币符号映射（与 LedgerSwitcher 保持一致）
// ─────────────────────────────────────────────────────────────
const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  CAD: 'CA$',
  USD: 'US$',
  HKD: 'HK$',
}
function getSymbol(currency?: string) {
  return CURRENCY_SYMBOL[currency ?? 'CNY'] ?? '¥'
}

// ─────────────────────────────────────────────────────────────
// 单张 KPI 卡
// ─────────────────────────────────────────────────────────────
interface KpiCardProps {
  label:    string
  amount:   number
  symbol:   string
  icon:     ReactNode
  /** Tailwind 背景色（仅用于图标区域） */
  iconBg:   string
  /** 金额文字颜色 */
  amtColor: string
  /** 正负前缀 */
  prefix?:  string
}

function KpiCard({ label, amount, symbol, icon, iconBg, amtColor, prefix }: KpiCardProps) {
  const formatted = amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <div className="card flex-1 min-w-0 py-3.5 px-4">
      {/* 标签行 */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className={`w-6 h-6 rounded-lg ${iconBg} flex items-center justify-center text-sm flex-shrink-0`}>
          {icon}
        </div>
        <p className="text-[11px] text-content-tertiary truncate">{label}</p>
      </div>

      {/* 金额大数字 */}
      <p className={`text-base font-bold tabular-nums leading-tight ${amtColor}`}>
        {prefix && <span className="text-xs mr-0.5 font-semibold">{prefix}</span>}
        <span className="text-xs mr-0.5">{symbol}</span>
        {formatted}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件（三卡横排，移动端自动换行）
// ─────────────────────────────────────────────────────────────
export interface StatCardsProps {
  income:    number
  expense:   number
  net:       number
  currency?: string   // ISO 4217，如 CNY / CAD
}

export default function StatCards({ income, expense, net, currency }: StatCardsProps) {
  const sym     = getSymbol(currency)
  const netPositive = net >= 0

  return (
    <div className="flex gap-2.5">
      {/* 收入 */}
      <KpiCard
        label="本月收入"
        amount={income}
        symbol={sym}
        icon="📈"
        iconBg="bg-emerald-50"
        amtColor="text-emerald-600"
      />

      {/* 支出 */}
      <KpiCard
        label="本月支出"
        amount={expense}
        symbol={sym}
        icon="📉"
        iconBg="bg-rose-50"
        amtColor="text-rose-500"
      />

      {/* 净结余 */}
      <KpiCard
        label="净结余"
        amount={Math.abs(net)}
        symbol={sym}
        icon={netPositive ? '💰' : '⚠️'}
        iconBg={netPositive ? 'bg-primary-50' : 'bg-amber-50'}
        amtColor={netPositive ? 'text-primary-600' : 'text-amber-600'}
        prefix={netPositive ? '+' : '-'}
      />
    </div>
  )
}
