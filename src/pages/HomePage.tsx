// 首页：账套切换 + 时钟/天气横幅 + 本月收支概览 + 最近账单列表
// S7 阶段：接入 LedgerSwitcher（Mock 驱动）+ CorrectionPolicyModal（纠偏演示）

import { useMemo, useState } from 'react'
import ImportModal           from '@/components/import/ImportModal'
import LedgerSwitcher        from '@/components/ledger/LedgerSwitcher'
import CorrectionPolicyModal from '@/components/ledger/CorrectionPolicyModal'

// 引入 Mock 数据
import {
  MOCK_THIS_MONTH,
  MOCK_INCOME,
  MOCK_EXPENSE,
} from '@/mock/transactions.mock'
import { MOCK_DEFAULT_LEDGER_ID } from '@/mock/ledgers.mock'

// 引入工具函数
import { formatAmount }  from '@/utils/numberUtils'
import { toChineseDate } from '@/utils/dateUtils'

// 引入 Widget 组件
import ClockWidget   from '@/widgets/ClockWidget'
import WeatherWidget from '@/widgets/WeatherWidget'

// 引入类型
import type { Transaction }      from '@/types/Transaction.types'
import type { CorrectionPolicy } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 子组件：收支概览卡片
// ─────────────────────────────────────────────────────────────
interface SummaryCardProps {
  label:  string
  amount: number
  type:   'income' | 'expense' | 'net'
}

function SummaryCard({ label, amount, type }: SummaryCardProps) {
  const amountColor =
    type === 'income'  ? 'text-income' :
    type === 'expense' ? 'text-expense' :
    amount >= 0        ? 'text-income' : 'text-expense'

  const prefix =
    type === 'net'    ? (amount >= 0 ? '+' : '-') :
    type === 'income' ? '+' : '-'

  return (
    <div className="card flex-1 flex flex-col items-center py-4 gap-1">
      <span className="text-xs text-content-tertiary">{label}</span>
      <span className={`text-lg font-bold ${amountColor}`}>
        <span className="text-sm font-medium mr-0.5">{prefix}¥</span>
        {formatAmount(Math.abs(amount))}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 子组件：分类图标映射
// ─────────────────────────────────────────────────────────────
const CATEGORY_ICON: Record<string, { icon: string; bg: string }> = {
  '餐饮':   { icon: '🍜', bg: 'bg-orange-50' },
  '交通':   { icon: '🚇', bg: 'bg-blue-50'   },
  '购物':   { icon: '🛍️', bg: 'bg-purple-50' },
  '娱乐':   { icon: '🎮', bg: 'bg-pink-50'   },
  '医疗':   { icon: '💊', bg: 'bg-red-50'    },
  '居住':   { icon: '🏠', bg: 'bg-yellow-50' },
  '教育':   { icon: '📚', bg: 'bg-cyan-50'   },
  '工资':   { icon: '💰', bg: 'bg-green-50'  },
  '副业收入': { icon: '💻', bg: 'bg-teal-50' },
  '理财收益': { icon: '📈', bg: 'bg-emerald-50' },
  '转账':   { icon: '↔️', bg: 'bg-gray-50'   },
  '未分类': { icon: '📋', bg: 'bg-slate-50'  },
}

function getCategoryMeta(category: string) {
  return CATEGORY_ICON[category] ?? { icon: '📋', bg: 'bg-gray-50' }
}

// ─────────────────────────────────────────────────────────────
// 子组件：单条账单列表项
// 右侧新增「纠偏」小按钮，点击触发 CorrectionPolicyModal
// ─────────────────────────────────────────────────────────────
interface BillItemProps {
  transaction: Transaction
  onCorrect: (tx: Transaction) => void  // 触发纠偏弹窗的回调
}

function BillItem({ transaction, onCorrect }: BillItemProps) {
  const { icon, bg } = getCategoryMeta(transaction.category)
  const isIncome     = transaction.amount > 0

  return (
    <div className="flex items-center gap-3 py-3 px-1 group">

      {/* 左侧：分类图标 */}
      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0 text-lg`}>
        {icon}
      </div>

      {/* 中间：描述 + 分类 + 日期 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-content-primary truncate">
          {transaction.description}
        </p>
        <p className="text-xs text-content-tertiary mt-0.5">
          <span>{transaction.category}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span>{toChineseDate(transaction.date)}</span>
        </p>
      </div>

      {/* 右侧：金额 + 纠偏按钮（hover 显示） */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* 纠偏按钮：平时透明，hover 时出现 */}
        <button
          onClick={() => onCorrect(transaction)}
          title="修改分类/账户"
          className="
            w-6 h-6 rounded-full bg-surface-overlay flex items-center justify-center
            text-content-tertiary hover:text-primary-600 hover:bg-primary-50
            transition-all opacity-0 group-hover:opacity-100
          "
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>

        {/* 金额 */}
        <div className="text-right">
          <span className={`text-sm font-semibold tabular-nums ${isIncome ? 'text-income' : 'text-content-primary'}`}>
            {isIncome ? '+' : '-'}¥{formatAmount(Math.abs(transaction.amount))}
          </span>
          <p className="text-[10px] text-content-tertiary mt-0.5">
            {transaction.source === 'wechat'  ? '微信'   :
             transaction.source === 'alipay'  ? '支付宝' :
             transaction.source === 'manual'  ? '手动'   : '银行'}
          </p>
        </div>
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件：HomePage
// ─────────────────────────────────────────────────────────────

// 纠偏弹窗的上下文状态（当前点击的是哪条账单）
interface CorrectionContext {
  field:    string
  oldValue: string
  newValue: string
}

function HomePage() {
  const netAmount  = useMemo(() => MOCK_INCOME - MOCK_EXPENSE, [])
  const recentBills = useMemo(() => MOCK_THIS_MONTH.slice(0, 8), [])

  // ── 弹窗状态 ──────────────────────────────────────────────
  // 导入弹窗
  const [importOpen, setImportOpen] = useState(false)
  // 纠偏弹窗
  const [correctionOpen, setCorrectionOpen] = useState(false)
  // 纠偏上下文（演示用固定值，S7 后从实际账单中读取）
  const [correctionCtx, setCorrectionCtx] = useState<CorrectionContext>({
    field:    '分类',
    oldValue: '未分类',
    newValue: '餐饮',
  })

  // ── 账套状态（暂用 React State，S7 后迁移至 ledgerStore） ─
  const [activeLedgerId, setActiveLedgerId] = useState(MOCK_DEFAULT_LEDGER_ID)

  // ── 点击账单的"纠偏"图标 ─────────────────────────────────
  function handleCorrect(tx: Transaction) {
    // 用实际账单信息填充上下文
    setCorrectionCtx({
      field:    '分类',
      oldValue: tx.category,
      newValue: tx.category === '未分类' ? '餐饮' : '未分类',  // 演示用对换
    })
    setCorrectionOpen(true)
  }

  // ── 纠偏确认回调 ──────────────────────────────────────────
  function handleCorrectionConfirm(policy: CorrectionPolicy) {
    // S5 前仅打印，S7 后接入 correctionService.apply(policy)
    console.log('[纠偏策略]', policy, correctionCtx)
    setCorrectionOpen(false)
  }

  return (
    <div className="page-container">

      {/* ══ 顶部标题栏：账套切换器 + 头像 ════════════════════ */}
      <div className="flex items-center justify-between mb-4 pt-1">
        {/* 左侧：账套切换器（替换原来的静态标题） */}
        <LedgerSwitcher
          activeLedgerId={activeLedgerId}
          onLedgerChange={setActiveLedgerId}
        />
        {/* 右侧：头像占位（S5 接入用户系统后替换） */}
        <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-base flex-shrink-0">
          👤
        </div>
      </div>

      {/* ══ 主横幅卡片：时钟 + 天气 + 收支概览 ════════════════ */}
      <div className="rounded-2xl p-5 mb-4 bg-gradient-to-br from-primary-700 to-primary-500 text-white shadow-fab">

        {/* 区域①：时钟 + 天气 */}
        <div className="flex flex-col gap-3 mb-5">
          <ClockWidget />
          <div className="h-px bg-white/10" />
          <WeatherWidget />
        </div>

        {/* 区域②：净收支 */}
        <div className="h-px bg-white/15 mb-4" />
        <p className="text-xs text-white/60 mb-1">本月净收支</p>
        <p className="text-3xl font-bold tracking-tight mb-4">
          <span className="text-xl mr-1">{netAmount >= 0 ? '+' : '−'}¥</span>
          {formatAmount(Math.abs(netAmount))}
        </p>

        {/* 区域③：收入 / 支出 */}
        <div className="flex gap-4">
          <div className="flex-1">
            <p className="text-xs text-white/60 mb-0.5">收入</p>
            <p className="text-base font-semibold text-white/95">¥{formatAmount(MOCK_INCOME)}</p>
          </div>
          <div className="w-px bg-white/20" />
          <div className="flex-1">
            <p className="text-xs text-white/60 mb-0.5">支出</p>
            <p className="text-base font-semibold text-white/95">¥{formatAmount(MOCK_EXPENSE)}</p>
          </div>
        </div>
      </div>

      {/* ══ 快捷操作入口 ══════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* 导入账单 */}
        <button
          onClick={() => setImportOpen(true)}
          className="card card-hover flex flex-col items-center py-4 gap-2 no-select"
        >
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-xl">📥</div>
          <span className="text-sm font-medium text-content-primary">导入账单</span>
          <span className="text-xs text-content-tertiary">微信 / 支付宝</span>
        </button>

        {/* 手动记账 */}
        <button className="card card-hover flex flex-col items-center py-4 gap-2 no-select">
          <div className="w-10 h-10 rounded-xl bg-income-bg flex items-center justify-center text-xl">✏️</div>
          <span className="text-sm font-medium text-content-primary">手动记账</span>
          <span className="text-xs text-content-tertiary">快速录入一笔</span>
        </button>
      </div>

      {/* ══ 纠偏演示入口条 ════════════════════════════════════ */}
      {/* 展示"补录纠偏"战略功能，S7 正式上线后替换为账单行内触发 */}
      <div className="flex items-center justify-between px-3.5 py-2.5 mb-4
                      bg-amber-50 rounded-xl border border-amber-100">
        <div className="flex items-center gap-2.5">
          {/* 图标 */}
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-base flex-shrink-0">
            🔄
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-800">补录纠偏 · 溯及既往</p>
            <p className="text-[11px] text-amber-500 mt-0.5">S7 核心功能 · 支持三种修改策略</p>
          </div>
        </div>
        {/* 演示按钮 */}
        <button
          onClick={() => {
            setCorrectionCtx({ field: '分类', oldValue: '未分类', newValue: '餐饮' })
            setCorrectionOpen(true)
          }}
          className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200
                     px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          演示弹窗 ›
        </button>
      </div>

      {/* ══ 最近账单列表 ══════════════════════════════════════ */}
      <div className="card">
        {/* 列表标题行 */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-content-primary">最近账单</h2>
          <button className="text-xs text-primary-600 font-medium">查看全部 ›</button>
        </div>
        <p className="text-xs text-content-tertiary mb-3">
          本月共 {MOCK_THIS_MONTH.length} 笔记录 · 悬停账单可纠偏分类
        </p>

        <div>
          {recentBills.length > 0 ? (
            recentBills.map((transaction, index) => (
              <div key={transaction.id}>
                {/* 账单行：传入 onCorrect 回调 */}
                <BillItem
                  transaction={transaction}
                  onCorrect={handleCorrect}
                />
                {index < recentBills.length - 1 && (
                  <div className="divider ml-14" />
                )}
              </div>
            ))
          ) : (
            <div className="py-10 text-center">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm text-content-tertiary">暂无账单数据</p>
              <p className="text-xs text-content-tertiary mt-1 opacity-70">导入账单或手动记账后显示</p>
            </div>
          )}
        </div>

        {MOCK_THIS_MONTH.length > 8 && (
          <button className="w-full mt-3 py-2.5 text-xs text-content-tertiary
                             bg-surface-overlay rounded-lg text-center hover:bg-gray-100
                             transition-colors">
            还有 {MOCK_THIS_MONTH.length - 8} 条记录，点击查看全部 ›
          </button>
        )}
      </div>

      {/* ══ 弹窗挂载区（最外层保证层级正确） ═════════════════ */}

      {/* 导入账单弹窗 */}
      <ImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
      />

      {/* 纠偏策略选择弹窗 */}
      <CorrectionPolicyModal
        isOpen={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        onConfirm={handleCorrectionConfirm}
        field={correctionCtx.field}
        oldValue={correctionCtx.oldValue}
        newValue={correctionCtx.newValue}
      />

    </div>
  )
}

export default HomePage
