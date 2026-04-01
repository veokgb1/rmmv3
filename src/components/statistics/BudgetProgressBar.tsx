// 月度预算监控 — S6 统计看板
// Mock 预算额度按账套类型设定（S9 阶段接入用户自定义预算 Firestore 集合）
// 视觉警告：< 60% 绿色 → 60-80% 琥珀 → 80-95% 橙色 → ≥95% 红色（高危脉冲）

import type { LedgerType } from '@/types/Ledger.types'

// ─────────────────────────────────────────────────────────────
// Mock 月度预算配置（S9 阶段替换为 Firestore budgets 集合读取）
// 架构备注：预算字段未进入当前 Schema，此处严格限定为 Mock 占位
// ─────────────────────────────────────────────────────────────
const MOCK_BUDGETS: Record<LedgerType, number> = {
  personal:   8000,   // 个人月度预算 ¥8,000
  family:     5000,   // 家庭月度预算 ¥5,000（长者专属账套）
  enterprise: 3000,   // 企业差旅/运营月度预算（CAD/CNY 通用额度）
}

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥', CAD: 'CA$', USD: 'US$', HKD: 'HK$',
}

// ─────────────────────────────────────────────────────────────
// 进度条颜色阈值
// ─────────────────────────────────────────────────────────────
interface ThresholdStyle {
  bar:     string   // 进度条填充色（Tailwind bg-*）
  text:    string   // 百分比文字色
  label:   string   // 状态描述
  pulse:   boolean  // 是否脉冲动画（高危）
}

function getThresholdStyle(pct: number): ThresholdStyle {
  if (pct >= 95) return {
    bar: 'bg-red-500', text: 'text-red-600',
    label: '⚠️ 严重超支风险', pulse: true,
  }
  if (pct >= 80) return {
    bar: 'bg-orange-400', text: 'text-orange-600',
    label: '注意：预算告急', pulse: false,
  }
  if (pct >= 60) return {
    bar: 'bg-amber-400', text: 'text-amber-600',
    label: '预算消耗较快', pulse: false,
  }
  return {
    bar: 'bg-emerald-500', text: 'text-emerald-600',
    label: '预算健康', pulse: false,
  }
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
interface BudgetProgressBarProps {
  expense:     number      // 本月实际支出（绝对值，已排除转账）
  ledgerType:  LedgerType  // 账套类型，用于查找 Mock 预算
  currency?:   string      // 货币代码（ISO 4217）
}

export default function BudgetProgressBar({
  expense,
  ledgerType,
  currency = 'CNY',
}: BudgetProgressBarProps) {
  const budget   = MOCK_BUDGETS[ledgerType] ?? MOCK_BUDGETS.personal
  const sym      = CURRENCY_SYMBOL[currency] ?? '¥'
  const pct      = Math.min(Math.round((expense / budget) * 100), 100)
  const overrun  = expense > budget
  const remaining = Math.max(budget - expense, 0)
  const style    = getThresholdStyle(pct)

  // 进度条实际填充宽度（CSS 用 style.width 动态设定，实现过渡动画）
  const barWidthPct = `${pct}%`

  return (
    <div>
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">💰</span>
          <p className="text-xs font-semibold text-content-primary">月度预算监控</p>
          <span className="text-[10px] px-1.5 py-0.5 bg-surface-overlay rounded-full
                           text-content-tertiary font-medium">
            Mock · S9 自定义
          </span>
        </div>
        <p className="text-xs text-content-tertiary tabular-nums">
          {sym}{budget.toLocaleString()}
        </p>
      </div>

      {/* 进度条轨道 */}
      <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${style.bar} ${
            style.pulse ? 'animate-pulse' : ''
          }`}
          style={{ width: barWidthPct }}
        />
        {/* 80% 警戒线刻度 */}
        <div
          className="absolute top-0 bottom-0 w-px bg-orange-300 opacity-60"
          style={{ left: '80%' }}
          title="80% 警戒线"
        />
      </div>

      {/* 底部状态行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-semibold tabular-nums ${style.text}`}>
            已用 {pct}%
          </span>
          <span className="text-[11px] text-content-tertiary">· {style.label}</span>
        </div>

        <p className="text-[11px] tabular-nums">
          {overrun ? (
            <span className="text-red-500 font-semibold">
              超支 {sym}{(expense - budget).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </span>
          ) : (
            <span className="text-content-tertiary">
              剩 {sym}{remaining.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </span>
          )}
        </p>
      </div>

      {/* 支出 / 预算 绝对值展示 */}
      <div className="flex items-center justify-between mt-1.5
                      pt-1.5 border-t border-gray-50">
        <p className="text-[11px] text-content-tertiary">
          已花 <span className="font-semibold text-rose-500 tabular-nums">
            {sym}{expense.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
          </span>
        </p>
        <p className="text-[11px] text-content-tertiary">
          预算 <span className="font-semibold text-content-secondary tabular-nums">
            {sym}{budget.toLocaleString()}
          </span>
        </p>
      </div>
    </div>
  )
}
