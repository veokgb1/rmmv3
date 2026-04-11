// TransactionDetailModal — 账单只读详情卡片
//
// 触发时机：点击 BillItem 的文字/金额区（非 Checkbox、非图片、非操作按钮）
// 职责：展示清爽的账单详情，底部提供【✏️ 编辑】入口，绝不直接打开修改表单
// 关闭方式：点击遮罩、右上角 ✕

import { useState }        from 'react'
import { StorageImage }    from '@/components/ui/StorageImage'
import { formatAmount }    from '@/utils/numberUtils'
import { toChineseDate }   from '@/utils/dateUtils'
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 分类图标（与 HomePage 保持一致）
// ─────────────────────────────────────────────────────────────
const CATEGORY_ICON: Record<string, { icon: string; bg: string; ring: string }> = {
  '餐饮':     { icon: '🍜', bg: 'bg-orange-100',  ring: 'ring-orange-200'  },
  '交通':     { icon: '🚇', bg: 'bg-blue-100',    ring: 'ring-blue-200'    },
  '购物':     { icon: '🛍️', bg: 'bg-purple-100',  ring: 'ring-purple-200'  },
  '娱乐':     { icon: '🎮', bg: 'bg-pink-100',    ring: 'ring-pink-200'    },
  '医疗':     { icon: '💊', bg: 'bg-red-100',     ring: 'ring-red-200'     },
  '居住':     { icon: '🏠', bg: 'bg-yellow-100',  ring: 'ring-yellow-200'  },
  '教育':     { icon: '📚', bg: 'bg-cyan-100',    ring: 'ring-cyan-200'    },
  '工资':     { icon: '💰', bg: 'bg-green-100',   ring: 'ring-green-200'   },
  '副业收入': { icon: '💻', bg: 'bg-teal-100',    ring: 'ring-teal-200'    },
  '理财收益': { icon: '📈', bg: 'bg-emerald-100', ring: 'ring-emerald-200' },
  '转账':     { icon: '↔️', bg: 'bg-gray-100',    ring: 'ring-gray-200'    },
  '未分类':   { icon: '📋', bg: 'bg-slate-100',   ring: 'ring-slate-200'   },
}
const getCatMeta = (cat: string) =>
  CATEGORY_ICON[cat] ?? { icon: '📌', bg: 'bg-slate-100', ring: 'ring-slate-200' }

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface TransactionDetailModalProps {
  tx:       Transaction | null
  onClose:  () => void
  onEdit:   (tx: Transaction) => void  // 点击"编辑"后由父组件打开 OmniInputModal
}

// ─────────────────────────────────────────────────────────────
// 单行详情字段
// ─────────────────────────────────────────────────────────────
function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="w-14 flex-shrink-0 text-xs text-slate-400 pt-px">{label}</span>
      <span className={`flex-1 text-sm text-slate-800 font-medium leading-snug ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
export default function TransactionDetailModal({
  tx, onClose, onEdit,
}: TransactionDetailModalProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  if (!tx) return null

  const isIncome  = tx.amount > 0
  const receipts  = tx.receiptUrls ?? []
  const { icon, bg, ring } = getCatMeta(tx.category)

  // 说明：V2 历史数据优先读 legacy_backup.summary
  const rawLegacy = tx.rawData?.['legacy_backup'] as Record<string, unknown> | undefined
  const legacySummary = rawLegacy?.['summary'] as string | undefined
  const descNotCat = tx.description !== tx.category ? tx.description : ''
  const displayDesc = legacySummary || descNotCat || tx.description || '无摘要'

  const sourceLabel =
    tx.source === 'wechat'  ? '微信支付' :
    tx.source === 'alipay'  ? '支付宝'   :
    tx.source === 'manual'  ? '手动录入' : '银行'

  return (
    <div
      className="fixed inset-0 z-[550] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* 卡片主体 */}
      <div
        className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl
                   shadow-2xl overflow-hidden animate-[slideUp_0.22s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        {/* 移动端把手 */}
        <div className="flex justify-center pt-3 pb-0 sm:hidden">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* ── 头部：金额 + 分类徽章 ─────────────────────── */}
        <div className={`px-6 pt-5 pb-5 flex items-center gap-4 ${isIncome ? 'bg-blue-50' : 'bg-red-50/50'}`}>

          {/* 分类图标 */}
          <div className={`w-14 h-14 rounded-2xl ${bg} ring-2 ${ring}
                           flex items-center justify-center text-2xl flex-shrink-0`}>
            {icon}
          </div>

          {/* 金额 + 分类 */}
          <div className="flex-1 min-w-0">
            <p className={`text-3xl font-black tabular-nums leading-none
                           ${isIncome ? 'text-blue-600' : 'text-rose-600'}`}>
              {isIncome ? '+' : '-'}¥{formatAmount(Math.abs(tx.amount))}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-sm font-semibold text-slate-700">{tx.category}</span>
              <span className="text-slate-300">·</span>
              <span className="text-sm text-slate-500">{toChineseDate(tx.date)}</span>
              {tx.sourceType === 'V2_to_V3' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                 bg-indigo-100 text-indigo-500">V2</span>
              )}
              {tx.isManuallyEdited && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                 bg-amber-100 text-amber-600">纠偏</span>
              )}
            </div>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/80
                       flex items-center justify-center text-slate-400
                       hover:text-slate-700 hover:bg-white transition-colors shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* ── 详情字段列表 ─────────────────────────────── */}
        <div className="px-6 pt-1 pb-2">
          <DetailRow label="说明"   value={displayDesc} />
          {tx.remark ? <DetailRow label="备注" value={tx.remark} /> : null}
          <DetailRow label="日期"   value={tx.date} />
          <DetailRow label="来源"   value={sourceLabel} />
          {tx.tags && tx.tags.length > 0 && (
            <DetailRow label="标签" value={tx.tags.map(t => `#${t}`).join('  ')} />
          )}
        </div>

        {/* ── 凭证图片缩略图列 ─────────────────────────── */}
        {receipts.length > 0 && (
          <div className="px-6 pb-3">
            <p className="text-xs text-slate-400 mb-2">凭证图片</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {receipts.map((url, idx) => (
                <button
                  key={url}
                  onClick={() => setLightboxIdx(idx)}
                  className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0
                             border border-slate-200 hover:ring-2 hover:ring-primary-400
                             transition-all"
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
        )}

        {/* ── 底部操作区 ─────────────────────────────── */}
        <div className="px-6 pt-2 pb-6 border-t border-slate-100">
          <button
            onClick={() => { onClose(); onEdit(tx) }}
            className="w-full py-3.5 rounded-2xl bg-primary-600 text-white
                       text-sm font-bold hover:bg-primary-700 active:scale-[0.98]
                       transition-all shadow-[0_4px_16px_rgba(20,184,166,0.35)]
                       flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
            </svg>
            编辑此账单
          </button>
        </div>
      </div>

      {/* ── Lightbox 全屏查看 ─────────────────────────── */}
      {lightboxIdx !== null && receipts[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/85 backdrop-blur-sm"
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
                           bg-white/15 text-white text-lg hover:bg-white/25 z-10
                           flex items-center justify-center"
              >‹</button>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % receipts.length) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                           bg-white/15 text-white text-lg hover:bg-white/25 z-10
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
        </div>
      )}
    </div>
  )
}
