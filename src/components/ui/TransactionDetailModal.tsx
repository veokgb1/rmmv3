// TransactionDetailModal — 账单只读存根卡片 (S21 重构)
//
// 视觉语言：「收据存根」—— bg-slate-50 灰底，零输入框样式，纯文字展示
// 意图：与 OmniInputModal（bg-white/bg-blue-50 + 输入控件）形成强烈视觉对比，
//        避免用户产生"我是不是在编辑？"的认知混淆
//
// 唯一 CTA：底部【✏️ 进入编辑模式】(bg-slate-700)，颜色刻意选用深灰而非 primary-600 teal
//            teal = 保存确认；深灰 = 非破坏性导航
//
// 流程：Detail → onEdit → setDetailTx(null) + handleCorrect(tx) → OmniInputModal
//        OmniInputModal 保存/取消 → handleOmniClose → 回 HomePage（不回 Detail）

import { useState }         from 'react'
import { StorageImage }     from '@/components/ui/StorageImage'
import { formatAmount }     from '@/utils/numberUtils'
import { toChineseDate }    from '@/utils/dateUtils'
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 分类图标映射
// ─────────────────────────────────────────────────────────────
const CATEGORY_ICON: Record<string, { icon: string; color: string }> = {
  '餐饮':     { icon: '🍜', color: 'text-orange-500' },
  '交通':     { icon: '🚇', color: 'text-blue-500'   },
  '购物':     { icon: '🛍️', color: 'text-purple-500' },
  '娱乐':     { icon: '🎮', color: 'text-pink-500'   },
  '医疗':     { icon: '💊', color: 'text-red-500'    },
  '居住':     { icon: '🏠', color: 'text-yellow-600' },
  '教育':     { icon: '📚', color: 'text-cyan-600'   },
  '工资':     { icon: '💰', color: 'text-green-600'  },
  '副业收入': { icon: '💻', color: 'text-teal-600'   },
  '理财收益': { icon: '📈', color: 'text-emerald-600'},
  '转账':     { icon: '↔️', color: 'text-gray-500'   },
  '未分类':   { icon: '📋', color: 'text-slate-500'  },
}
const getCatMeta = (cat: string) =>
  CATEGORY_ICON[cat] ?? { icon: '📌', color: 'text-slate-500' }

// ─────────────────────────────────────────────────────────────
// 存根字段行（纯文字，无输入框样式）
// ─────────────────────────────────────────────────────────────
function StubRow({
  label, value, accent = false, mono = false,
}: {
  label:  string
  value:  string
  accent?: boolean   // 高亮值（用于备注等需要区分的字段）
  mono?:  boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="w-12 flex-shrink-0 text-[11px] text-slate-400 pt-0.5 uppercase tracking-wide">
        {label}
      </span>
      <span className={[
        'flex-1 text-sm leading-snug',
        accent ? 'text-slate-600 italic' : 'text-slate-700 font-medium',
        mono   ? 'font-mono text-xs'     : '',
      ].join(' ')}>
        {value}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface TransactionDetailModalProps {
  tx:       Transaction | null
  onClose:  () => void
  /** 点击"进入编辑模式"后由父组件关闭 Detail 并打开 OmniInputModal */
  onEdit:   (tx: Transaction) => void
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
export default function TransactionDetailModal({
  tx, onClose, onEdit,
}: TransactionDetailModalProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  if (!tx) return null

  const isIncome   = tx.amount > 0
  const receipts   = tx.receiptUrls ?? []
  const { icon, color } = getCatMeta(tx.category)

  const rawLegacy    = tx.rawData?.['legacy_backup'] as Record<string, unknown> | undefined
  const legacySummary = rawLegacy?.['summary'] as string | undefined
  const descNotCat   = tx.description !== tx.category ? tx.description : ''
  const displayDesc  = legacySummary || descNotCat || tx.description || ''

  const sourceLabel =
    tx.source === 'wechat' ? '微信支付' :
    tx.source === 'alipay' ? '支付宝'   :
    tx.source === 'manual' ? '手动录入' : '银行'

  return (
    <div
      className="fixed inset-0 z-[550] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* 遮罩（比 OmniInputModal z-[500] 更高一档，确保层级正确）*/}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* ══ 存根卡片主体：bg-slate-50 灰底，圆角 ══ */}
      <div
        className="relative w-full max-w-md bg-slate-50 rounded-t-3xl sm:rounded-2xl
                   shadow-xl overflow-hidden animate-[slideUp_0.2s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        {/* 移动端把手 */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="w-8 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* ── 顶部标识栏（极细，仅用颜色线条暗示收支类型）── */}
        <div className={`h-0.5 w-full mt-2 ${isIncome ? 'bg-blue-300' : 'bg-rose-300'}`} />

        {/* ── 金额 + 分类区（白色背景，清晰突出）────────── */}
        <div className="bg-white px-5 pt-4 pb-4 flex items-center gap-4">

          {/* 分类图标（小号，素色）*/}
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center
                          text-xl flex-shrink-0">
            {icon}
          </div>

          {/* 金额 + 分类 + 日期 */}
          <div className="flex-1 min-w-0">
            <p className={`text-2xl font-black tabular-nums leading-none
                           ${isIncome ? 'text-blue-600' : 'text-rose-600'}`}>
              {isIncome ? '+' : '−'}¥{formatAmount(Math.abs(tx.amount))}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={`text-xs font-bold ${color}`}>{icon} {tx.category}</span>
              <span className="text-slate-300 text-xs">·</span>
              <span className="text-xs text-slate-400">{toChineseDate(tx.date)}</span>
              {/* 系统徽章 */}
              {tx.sourceType === 'V2_to_V3' && (
                <span className="text-[9px] font-bold px-1 py-px rounded bg-indigo-100 text-indigo-500">V2</span>
              )}
              {tx.isManuallyEdited && (
                <span className="text-[9px] font-bold px-1 py-px rounded bg-amber-100 text-amber-600">纠偏</span>
              )}
              {tx.isVerified && (
                <span className="text-[9px] font-bold px-1 py-px rounded bg-green-100 text-green-600">已核实</span>
              )}
            </div>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-3 right-4 w-6 h-6 rounded-full bg-slate-200
                       flex items-center justify-center text-slate-400
                       hover:text-slate-600 hover:bg-slate-300 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* ── 存根分隔线（锯齿感打孔虚线）────────────────── */}
        <div className="mx-4 border-t border-dashed border-slate-200" />

        {/* ── 字段列表（纯文字，零输入框）─────────────────── */}
        <div className="px-5 py-2">
          <StubRow label="说明" value={displayDesc} />
          <StubRow label="备注" value={tx.remark ?? ''} accent />
          <StubRow label="日期" value={tx.date} />
          <StubRow label="来源" value={sourceLabel} />
          {tx.tags && tx.tags.length > 0 && (
            <StubRow label="标签" value={tx.tags.map(t => `#${t}`).join('  ')} />
          )}
        </div>

        {/* ── 凭证图片（只读，纯展示）─────────────────────── */}
        {receipts.length > 0 && (
          <>
            <div className="mx-4 border-t border-dashed border-slate-200" />
            <div className="px-5 py-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">
                凭证图片 · {receipts.length} 张
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {receipts.map((url, idx) => (
                  <button
                    key={url}
                    onClick={() => setLightboxIdx(idx)}
                    className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0
                               border border-slate-200 hover:ring-2 hover:ring-slate-400
                               transition-all"
                    title={`查看第 ${idx + 1} 张凭证`}
                  >
                    <StorageImage
                      path={url}
                      alt={`凭证 ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── 存根底部撕边线 ────────────────────────────────── */}
        <div className="mx-4 border-t border-dashed border-slate-200" />

        {/* ── 唯一 CTA：进入编辑模式 ───────────────────────── */}
        <div className="px-5 py-4">
          <button
            onClick={() => { onClose(); onEdit(tx) }}
            className="w-full py-3 rounded-xl
                       bg-slate-700 hover:bg-slate-800 active:bg-slate-900
                       text-white text-sm font-semibold
                       flex items-center justify-center gap-2
                       transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536
                       L6.5 21.036H3v-3.572L16.732 3.732z"/>
            </svg>
            ✏️ 进入编辑模式
          </button>
        </div>

      </div>

      {/* ── Lightbox ─────────────────────────────────────── */}
      {lightboxIdx !== null && receipts[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/85"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-xl hover:bg-white/25 z-10"
            onClick={() => setLightboxIdx(null)}
          >×</button>
          {receipts.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + receipts.length) % receipts.length) }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                           bg-white/15 text-white text-xl hover:bg-white/25 z-10
                           flex items-center justify-center"
              >‹</button>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % receipts.length) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                           bg-white/15 text-white text-xl hover:bg-white/25 z-10
                           flex items-center justify-center"
              >›</button>
            </>
          )}
          <StorageImage
            path={receipts[lightboxIdx]}
            alt={`凭证 ${lightboxIdx + 1}`}
            className="max-w-[92vw] max-h-[80vh] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-white/60">
            {lightboxIdx + 1} / {receipts.length}
          </p>
        </div>
      )}
    </div>
  )
}
