// 首页 — S7 第二波：全面接入 Zustand Store
// 账套切换后，净收支大数字 + 账单列表自动级联刷新（物理联动）
// 数据流：LedgerSwitcher → ledgerStore → useBills → 重渲染

import { useState } from 'react'
import ImportModal           from '@/components/import/ImportModal'
import LedgerSwitcher        from '@/components/ledger/LedgerSwitcher'
import CorrectionPolicyModal from '@/components/ledger/CorrectionPolicyModal'

// 业务 Hook（订阅 Zustand Store，替代所有 Mock 常量）
import { useBills }  from '@/hooks/useBills'
import { useLedger } from '@/hooks/useLedger'

// 工具函数
import { formatAmount }  from '@/utils/numberUtils'
import { toChineseDate } from '@/utils/dateUtils'

// Widget 组件
import ClockWidget   from '@/widgets/ClockWidget'
import WeatherWidget from '@/widgets/WeatherWidget'

// 类型
import type { Transaction }      from '@/types/Transaction.types'
import type { CorrectionPolicy, CorrectionIntent } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 分类图标映射
// ─────────────────────────────────────────────────────────────
const CATEGORY_ICON: Record<string, { icon: string; bg: string }> = {
  '餐饮':     { icon: '🍜', bg: 'bg-orange-50'  },
  '交通':     { icon: '🚇', bg: 'bg-blue-50'    },
  '购物':     { icon: '🛍️', bg: 'bg-purple-50'  },
  '娱乐':     { icon: '🎮', bg: 'bg-pink-50'    },
  '医疗':     { icon: '💊', bg: 'bg-red-50'     },
  '居住':     { icon: '🏠', bg: 'bg-yellow-50'  },
  '教育':     { icon: '📚', bg: 'bg-cyan-50'    },
  '工资':     { icon: '💰', bg: 'bg-green-50'   },
  '副业收入': { icon: '💻', bg: 'bg-teal-50'    },
  '理财收益': { icon: '📈', bg: 'bg-emerald-50' },
  '转账':     { icon: '↔️', bg: 'bg-gray-50'    },
  '未分类':   { icon: '📋', bg: 'bg-slate-50'   },
}
const getCategoryMeta = (cat: string) => CATEGORY_ICON[cat] ?? { icon: '📋', bg: 'bg-gray-50' }

// ─────────────────────────────────────────────────────────────
// 子组件：单条账单行（带 hover 纠偏按钮 + 血缘标记）
// ─────────────────────────────────────────────────────────────
interface BillItemProps {
  transaction: Transaction
  onCorrect:   (tx: Transaction) => void
}

function BillItem({ transaction: tx, onCorrect }: BillItemProps) {
  const { icon, bg } = getCategoryMeta(tx.category)
  const isIncome     = tx.amount > 0

  return (
    <div className="flex items-center gap-3 py-3 px-1 group">

      {/* 分类图标 */}
      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0 text-lg`}>
        {icon}
      </div>

      {/* 描述 + 分类 + 日期 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-content-primary truncate">
            {tx.description}
          </p>
          {/* 血缘标记：该账单是跨账套克隆副本时显示（SX 阶段完整实现） */}
          {tx.clonedFromId && tx.sourceLedgerId && (
            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5
                             bg-violet-50 text-violet-500 rounded-full border border-violet-100">
              ↗ 副本
            </span>
          )}
          {/* 人工修正标记 */}
          {tx.isManuallyEdited && (
            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5
                             bg-amber-50 text-amber-500 rounded-full border border-amber-100">
              已纠偏
            </span>
          )}
        </div>
        <p className="text-xs text-content-tertiary mt-0.5">
          <span>{tx.category}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span>{toChineseDate(tx.date)}</span>
          {/* 标签（最多显示 2 个） */}
          {tx.tags && tx.tags.length > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              {tx.tags.slice(0, 2).map(tag => (
                <span key={tag} className="mr-1 text-primary-400">#{tag}</span>
              ))}
            </>
          )}
        </p>
      </div>

      {/* 金额 + 纠偏按钮 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* hover 显示纠偏按钮 */}
        <button
          onClick={() => onCorrect(tx)}
          title="纠偏分类"
          className="w-6 h-6 rounded-full bg-surface-overlay flex items-center justify-center
                     text-content-tertiary hover:text-primary-600 hover:bg-primary-50
                     transition-all opacity-0 group-hover:opacity-100"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>

        <div className="text-right">
          <span className={`text-sm font-semibold tabular-nums
            ${isIncome ? 'text-income' : 'text-content-primary'}`}>
            {isIncome ? '+' : '-'}¥{formatAmount(Math.abs(tx.amount))}
          </span>
          <p className="text-[10px] text-content-tertiary mt-0.5">
            {tx.source === 'wechat'  ? '微信'   :
             tx.source === 'alipay'  ? '支付宝' :
             tx.source === 'manual'  ? '手动'   : '银行'}
          </p>
        </div>
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件：HomePage
// ─────────────────────────────────────────────────────────────
interface CorrectionCtx {
  tx:       Transaction
  field:    string
  oldValue: string
  newValue: string
}

function HomePage() {
  // ── 数据层：订阅 Zustand Store，账套切换时自动重渲染 ─────
  const { income, expense, net, thisMonthBills, totalCount } = useBills()
  const { activeLedger } = useLedger()

  // 取最近 8 条展示
  const recentBills = thisMonthBills.slice(0, 8)

  // ── 弹窗状态 ──────────────────────────────────────────────
  const [importOpen,      setImportOpen]      = useState(false)
  const [correctionOpen,  setCorrectionOpen]  = useState(false)
  const [correctionCtx,   setCorrectionCtx]   = useState<CorrectionCtx | null>(null)

  // ── useBills 的 correct 函数（带账套隔离保证） ────────────
  const { correct } = useBills()

  // ── 点击账单行的纠偏按钮 ─────────────────────────────────
  function handleCorrect(tx: Transaction) {
    const newCat = tx.category === '未分类' ? '餐饮' : '未分类'
    setCorrectionCtx({ tx, field: '分类', oldValue: tx.category, newValue: newCat })
    setCorrectionOpen(true)
  }

  // ── 纠偏弹窗确认 ─────────────────────────────────────────
  function handleCorrectionConfirm(policy: CorrectionPolicy) {
    if (!correctionCtx) return
    const intent: CorrectionIntent = {
      transactionId: correctionCtx.tx.id,
      field:         'category',
      oldValue:      correctionCtx.oldValue,
      newValue:      correctionCtx.newValue,
      policy,
    }
    correct(policy, intent)
    setCorrectionOpen(false)
    setCorrectionCtx(null)
  }

  return (
    <div className="page-container">

      {/* ══ 顶部标题栏：账套切换器（已绑定 Store） ═══════════ */}
      <div className="flex items-center justify-between mb-4 pt-1">
        {/* LedgerSwitcher 不再需要任何 Props，直接读写 Store */}
        <LedgerSwitcher />
        <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-base flex-shrink-0">
          👤
        </div>
      </div>

      {/* ══ 主横幅卡片（数据来自 useBills，账套切换时自动更新） ══ */}
      <div className="rounded-2xl p-5 mb-4 bg-gradient-to-br from-primary-700 to-primary-500 text-white shadow-fab">

        {/* 时钟 + 天气 */}
        <div className="flex flex-col gap-3 mb-5">
          <ClockWidget />
          <div className="h-px bg-white/10" />
          <WeatherWidget />
        </div>

        <div className="h-px bg-white/15 mb-4" />

        {/* 净收支大数字（账套切换 → useBills → net 重算 → 此处自动刷新） */}
        <p className="text-xs text-white/60 mb-1">
          本月净收支
          {/* 显示当前账套名，切换账套时此处也跟着变 */}
          <span className="ml-2 px-2 py-0.5 bg-white/15 rounded-full text-[11px] font-medium">
            {activeLedger?.name ?? '加载中…'}
          </span>
        </p>
        <p className="text-3xl font-bold tracking-tight mb-4">
          <span className="text-xl mr-1">{net >= 0 ? '+' : '−'}¥</span>
          {formatAmount(Math.abs(net))}
        </p>

        {/* 收入 / 支出 */}
        <div className="flex gap-4">
          <div className="flex-1">
            <p className="text-xs text-white/60 mb-0.5">收入</p>
            <p className="text-base font-semibold text-white/95">¥{formatAmount(income)}</p>
          </div>
          <div className="w-px bg-white/20" />
          <div className="flex-1">
            <p className="text-xs text-white/60 mb-0.5">支出</p>
            <p className="text-base font-semibold text-white/95">¥{formatAmount(expense)}</p>
          </div>
        </div>
      </div>

      {/* ══ 快捷操作 ══════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => setImportOpen(true)}
          className="card card-hover flex flex-col items-center py-4 gap-2 no-select"
        >
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-xl">📥</div>
          <span className="text-sm font-medium text-content-primary">导入账单</span>
          <span className="text-xs text-content-tertiary">微信 / 支付宝</span>
        </button>
        <button className="card card-hover flex flex-col items-center py-4 gap-2 no-select">
          <div className="w-10 h-10 rounded-xl bg-income-bg flex items-center justify-center text-xl">✏️</div>
          <span className="text-sm font-medium text-content-primary">手动记账</span>
          <span className="text-xs text-content-tertiary">快速录入一笔</span>
        </button>
      </div>

      {/* ══ 账单视图 Tab 栏 ══════════════════════════════════ */}
      <div className="flex items-center gap-2 mb-4">
        {/* 已结清 Tab — 当前激活 */}
        <button className="flex-1 py-2 text-xs font-semibold rounded-xl
                           bg-primary-600 text-white shadow-sm">
          ✅ 已结清
        </button>
        {/* 预支出 Tab — 待开发占位 */}
        <button
          disabled
          className="flex-1 py-2 text-xs font-medium rounded-xl
                     bg-surface-overlay text-content-tertiary
                     opacity-60 cursor-not-allowed relative"
          title="预支出管理 · 开发中"
        >
          <span>📅 预支出</span>
          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5
                           bg-amber-100 text-amber-600 text-[10px] font-bold
                           rounded-full leading-none">
            🚧 S9
          </span>
        </button>
      </div>

      {/* ══ 纠偏演示入口条 ════════════════════════════════════ */}
      <div className="flex items-center justify-between px-3.5 py-2.5 mb-4
                      bg-amber-50 rounded-xl border border-amber-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-base flex-shrink-0">
            🔄
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-800">补录纠偏 · 溯及既往</p>
            <p className="text-[11px] text-amber-500 mt-0.5">S7 核心功能 · 支持三种修改策略</p>
          </div>
        </div>
        <button
          onClick={() => {
            // 演示：用第一条账单填充上下文
            const first = thisMonthBills[0]
            if (first) {
              setCorrectionCtx({
                tx:       first,
                field:    '分类',
                oldValue: first.category,
                newValue: first.category === '未分类' ? '餐饮' : '未分类',
              })
            }
            setCorrectionOpen(true)
          }}
          className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200
                     px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          演示弹窗 ›
        </button>
      </div>

      {/* ══ 最近账单列表（来自 useBills，账套隔离保证） ══════ */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-content-primary">最近账单</h2>
          <button className="text-xs text-primary-600 font-medium">查看全部 ›</button>
        </div>
        <p className="text-xs text-content-tertiary mb-3">
          {/* 账套切换时条数实时更新 */}
          本月共 {totalCount} 笔记录 · 悬停可纠偏分类
        </p>

        <div>
          {recentBills.length > 0 ? (
            recentBills.map((tx, index) => (
              <div key={tx.id}>
                <BillItem transaction={tx} onCorrect={handleCorrect} />
                {index < recentBills.length - 1 && (
                  <div className="divider ml-14" />
                )}
              </div>
            ))
          ) : (
            // 空状态：该账套本月无数据
            <div className="py-10 text-center">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm text-content-tertiary">
                「{activeLedger?.name}」本月暂无账单
              </p>
              <p className="text-xs text-content-tertiary mt-1 opacity-70">
                导入账单或手动记账后显示
              </p>
            </div>
          )}
        </div>

        {totalCount > 8 && (
          <button className="w-full mt-3 py-2.5 text-xs text-content-tertiary
                             bg-surface-overlay rounded-lg text-center hover:bg-gray-100
                             transition-colors">
            还有 {totalCount - 8} 条记录，点击查看全部 ›
          </button>
        )}
      </div>

      {/* ══ 弹窗挂载区 ════════════════════════════════════════ */}
      <ImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <CorrectionPolicyModal
        isOpen={correctionOpen}
        onClose={() => { setCorrectionOpen(false); setCorrectionCtx(null) }}
        onConfirm={handleCorrectionConfirm}
        field={correctionCtx?.field ?? '分类'}
        oldValue={correctionCtx?.oldValue ?? ''}
        newValue={correctionCtx?.newValue ?? ''}
      />

    </div>
  )
}

export default HomePage
