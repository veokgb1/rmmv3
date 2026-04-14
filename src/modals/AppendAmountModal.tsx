// AppendAmountModal — 追加凭证时的金额合并拦截弹窗 (S21 Phase 2)
//
// 触发时机：
//   用户为已有凭证（receiptUrls.length >= 1）的账单追加新凭证时（上传或从池关联）
//
// 职责：
//   1. 展示当前账单金额 ¥A 和新凭证填入金额 ¥B
//   2. 让用户选择：保持原金额 ¥A / 合并为 ¥(A+B)
//   3. 返回用户选择，由父组件执行实际更新
//
// 设计说明：
//   · B 字段为"此次新增凭证的金额"，需用户手动输入或由 OCR 预填
//   · 当 B = 0 时，"合并"等价于"保持原金额"，UI 会自动提示
//   · A+B 按照原始金额符号计算（正收入/负支出），绝对值相加

import { useState }       from 'react'
import { StorageImage }   from '@/components/ui/StorageImage'
import { formatAmount }   from '@/utils/numberUtils'

// ════════════════════════════════════════════════════════════════
// Props
// ════════════════════════════════════════════════════════════════

export interface AppendAmountResult {
  /** null = 保持原金额 ¥A；number = 合并后的新金额（含符号）*/
  newAmount: number | null
}

interface AppendAmountModalProps {
  /** 当前账单金额（含正负符号，如 -88.5 表示支出 88.5）*/
  originalAmount: number
  /** 新增凭证的 Storage URL（用于预览，可选）*/
  evidenceUrl?:   string
  /** 确认回调 */
  onConfirm:      (result: AppendAmountResult) => void
  /** 取消（不关联凭证，不修改金额）*/
  onCancel:       () => void
}

// ════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════

export default function AppendAmountModal({
  originalAmount,
  evidenceUrl,
  onConfirm,
  onCancel,
}: AppendAmountModalProps) {
  const isIncome   = originalAmount > 0
  const absA       = Math.abs(originalAmount)
  const sign       = isIncome ? 1 : -1

  const [bStr,     setBStr]     = useState('')          // 用户输入的 ¥B（绝对值）
  const [choice,   setChoice]   = useState<'keep' | 'merge'>('keep')  // 默认保持原金额
  const [lightbox, setLightbox] = useState(false)

  const absB = parseFloat(bStr) || 0
  const mergedAbs = absA + absB
  const mergedAmount = sign * mergedAbs

  const isBZero = absB === 0

  function handleConfirm(): void {
    if (choice === 'keep') {
      onConfirm({ newAmount: null })
    } else {
      onConfirm({ newAmount: mergedAmount })
    }
  }

  return (
    <div
      className="fixed inset-0 z-[620] flex items-center justify-center
                 bg-black/60 backdrop-blur-sm px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 顶部色带 */}
        <div className="h-1 bg-gradient-to-r from-primary-400 via-teal-400 to-primary-400" />

        {/* 头部 */}
        <div className="flex items-start justify-between px-5 pt-5 pb-1">
          <div>
            <h3 className="text-base font-bold text-slate-800">追加凭证 — 金额确认</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              该账单已有凭证，请选择金额处理方式
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-full
                       text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* 当前账单金额展示 */}
          <div className="flex items-center gap-3 px-3 py-3
                          bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex-1">
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                当前账单金额 ¥A
              </p>
              <p className={`text-2xl font-black tabular-nums mt-0.5
                             ${isIncome ? 'text-blue-600' : 'text-rose-600'}`}>
                {isIncome ? '+' : '-'}¥{formatAmount(absA)}
              </p>
            </div>

            {/* 凭证缩略图预览（可点击放大）*/}
            {evidenceUrl && (
              <button
                onClick={() => setLightbox(true)}
                className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200
                           hover:ring-2 hover:ring-primary-400 transition-all flex-shrink-0"
              >
                <StorageImage
                  path={evidenceUrl}
                  alt="新增凭证预览"
                  className="w-full h-full object-cover"
                />
              </button>
            )}
          </div>

          {/* 新凭证金额输入 ¥B */}
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1.5">
              本次新凭证金额 ¥B
              <span className="ml-1 text-slate-400 font-normal">（选填，用于合并计算）</span>
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold text-slate-400">
                {isIncome ? '+¥' : '-¥'}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={bStr}
                onChange={e => { setBStr(e.target.value); if (parseFloat(e.target.value) > 0) setChoice('merge') }}
                className="w-full pl-10 pr-4 py-2.5 text-xl font-bold tabular-nums
                           bg-slate-100 text-slate-900 rounded-xl
                           border-2 border-transparent focus:border-primary-300 focus:bg-white
                           outline-none transition-all placeholder:text-slate-300"
              />
            </div>
          </div>

          {/* 选项卡片 */}
          <div className="space-y-2">

            {/* 选项 1：保持原金额 */}
            <button
              onClick={() => setChoice('keep')}
              className={[
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left',
                choice === 'keep'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-slate-200 hover:border-slate-300',
              ].join(' ')}
            >
              <div className={[
                'w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center',
                choice === 'keep' ? 'border-primary-500' : 'border-slate-300',
              ].join(' ')}>
                {choice === 'keep' && (
                  <div className="w-2 h-2 rounded-full bg-primary-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${choice === 'keep' ? 'text-primary-700' : 'text-slate-700'}`}>
                  保持原金额
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  仅追加凭证图片，账单金额不变
                  {' · '}<span className={`font-semibold ${isIncome ? 'text-blue-600' : 'text-rose-600'}`}>
                    {isIncome ? '+' : '-'}¥{formatAmount(absA)}
                  </span>
                </p>
              </div>
              <span className="text-xs font-bold text-slate-300">默认</span>
            </button>

            {/* 选项 2：合并金额 A+B */}
            <button
              onClick={() => setChoice('merge')}
              className={[
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left',
                choice === 'merge'
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-slate-200 hover:border-slate-300',
                isBZero ? 'opacity-50' : '',
              ].join(' ')}
            >
              <div className={[
                'w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center',
                choice === 'merge' ? 'border-teal-500' : 'border-slate-300',
              ].join(' ')}>
                {choice === 'merge' && (
                  <div className="w-2 h-2 rounded-full bg-teal-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${choice === 'merge' ? 'text-teal-700' : 'text-slate-700'}`}>
                  合并为 A＋B
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isBZero
                    ? '请先在上方填入新凭证金额'
                    : <>
                        ¥{formatAmount(absA)} ＋ ¥{formatAmount(absB)} =
                        {' '}<span className={`font-bold ${isIncome ? 'text-blue-600' : 'text-rose-600'}`}>
                          {isIncome ? '+' : '-'}¥{formatAmount(mergedAbs)}
                        </span>
                      </>
                  }
                </p>
              </div>
            </button>
          </div>

        </div>

        {/* 底部操作区 */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium
                       bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            取消关联
          </button>
          <button
            onClick={handleConfirm}
            className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                       bg-primary-600 hover:bg-primary-700 text-white transition-colors shadow-sm"
          >
            {choice === 'keep'
              ? '✅ 追加凭证（保持金额）'
              : `✅ 追加凭证（合并为 ¥${formatAmount(mergedAbs)}）`
            }
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && evidenceUrl && (
        <div
          className="fixed inset-0 z-[700] flex items-center justify-center bg-black/85"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center
                       rounded-full bg-white/15 text-white text-xl"
            onClick={() => setLightbox(false)}
          >×</button>
          <StorageImage
            path={evidenceUrl}
            alt="凭证预览"
            className="max-w-[90vw] max-h-[80vh] rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
