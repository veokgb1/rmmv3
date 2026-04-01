// OmniInputModal — 全能记账舱 (S8)
// 底部滑入抽屉，支持手写录入（默认）/ 语音速记（S9占位）/ 拍小票（S9占位）
// 写入路径：表单 → addTransaction(Firestore) → onSnapshot → billStore → UI自动重绘
// 注意：保存成功后直接关闭弹窗，不手动更新本地 Store（享受单向数据流的优雅）

import { useState, useEffect, useRef } from 'react'
import { addTransaction }   from '@/services/firebase/billService'
import { useLedgerStore }   from '@/store/ledgerStore'
import type { SystemCategory } from '@/types/Category.types'
import type { Transaction }    from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 支出分类选项（SystemCategory 子集，收入单独一套）
// ─────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES: SystemCategory[] = [
  '餐饮','交通','购物','娱乐','医疗','居住','教育','未分类',
]
const INCOME_CATEGORIES: SystemCategory[] = [
  '工资','副业收入','理财收益','转账','未分类',
]

const CATEGORY_ICON: Record<string, string> = {
  '餐饮':'🍜','交通':'🚇','购物':'🛍️','娱乐':'🎮',
  '医疗':'💊','居住':'🏠','教育':'📚','未分类':'📋',
  '工资':'💰','副业收入':'💻','理财收益':'📈','转账':'↔️',
}

// ─────────────────────────────────────────────────────────────
// 今天的日期字符串（YYYY-MM-DD）
// ─────────────────────────────────────────────────────────────
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface OmniInputModalProps {
  isOpen:  boolean
  onClose: () => void
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
export default function OmniInputModal({ isOpen, onClose }: OmniInputModalProps) {
  // ── 顶部 Tab ──────────────────────────────────────────────
  type InputTab = 'manual' | 'voice' | 'ocr'
  const [activeTab, setActiveTab] = useState<InputTab>('manual')

  // ── 表单状态 ──────────────────────────────────────────────
  type TxType = 'expense' | 'income' | 'expected'
  const [txType,   setTxType]   = useState<TxType>('expense')
  const [amountStr,setAmountStr] = useState('')
  const [category, setCategory] = useState<SystemCategory>('餐饮')
  const [date,     setDate]     = useState(todayStr())
  const [note,     setNote]     = useState('')

  // ── 提交状态机 ────────────────────────────────────────────
  type SubmitState = 'idle' | 'saving' | 'success' | 'error'
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMsg,    setErrorMsg]    = useState('')

  // ── 当收入/支出切换时，自动切换到合适的默认分类 ──────────
  useEffect(() => {
    setCategory(txType === 'expense' || txType === 'expected' ? '餐饮' : '工资')
  }, [txType])

  // ── 打开时重置表单 ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setActiveTab('manual')
      setTxType('expense')
      setAmountStr('')
      setCategory('餐饮')
      setDate(todayStr())
      setNote('')
      setSubmitState('idle')
      setErrorMsg('')
    }
  }, [isOpen])

  // ── 金额输入框自动聚焦 ────────────────────────────────────
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isOpen && activeTab === 'manual') {
      setTimeout(() => amountRef.current?.focus(), 150)
    }
  }, [isOpen, activeTab])

  // ── 当前账套 ID（从 Store 直接读，不通过 UI 层传入） ──────
  const activeLedgerId = useLedgerStore(s => s.activeLedgerId)

  // ── 表单校验 ──────────────────────────────────────────────
  function validate(): string | null {
    const amt = parseFloat(amountStr)
    if (!amountStr || isNaN(amt) || amt <= 0) return '金额不能为空且必须大于 0'
    if (!date) return '请选择日期'
    return null
  }

  // ── 提交 ──────────────────────────────────────────────────
  async function handleSave() {
    const err = validate()
    if (err) { setErrorMsg(err); return }

    setErrorMsg('')
    setSubmitState('saving')

    const amt = parseFloat(amountStr)
    // 支出/预支出为负，收入为正（符合 Transaction.amount 约定）
    const signedAmount = txType === 'income' ? amt : -amt

    const data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      ledgerId:   activeLedgerId,
      userId:     'mock-user',          // S5 Auth 接入后替换为真实 UID
      date,
      amount:     signedAmount,
      category,
      description: note.trim() || category,
      source:      'manual',
      sourceType:  'manual',
      status:      txType === 'expected' ? 'expected' : 'cleared',
      tags:        [],
      accountId:   'acc-manual',
      rawData:     {},
      isManuallyEdited: false,
    }

    try {
      await addTransaction(data)
      setSubmitState('success')
      // 成功：短暂显示成功态后关闭
      // onSnapshot 已在监听，UI 会自动重绘，无需手动推 Store
      setTimeout(() => onClose(), 600)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg.slice(0, 120))
      setSubmitState('error')
    }
  }

  if (!isOpen) return null

  const categories = txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* 底部抽屉 */}
      <div className="fixed bottom-0 left-0 right-0 z-50
                      bg-white rounded-t-2xl shadow-2xl
                      max-h-[90vh] overflow-y-auto
                      animate-[slideUp_0.25s_ease-out]">

        {/* 顶部把手 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* 标题行 */}
        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-base font-bold text-content-primary">记一笔</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full
                       bg-surface-overlay text-content-tertiary hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        {/* ── 顶部 Tab：手写 / 语音 / 拍照 ─────────────── */}
        <div className="flex gap-2 px-5 mb-4">
          {/* 手写录入 */}
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
              activeTab === 'manual'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-surface-overlay text-content-tertiary'
            }`}
          >
            ✍️ 手写录入
          </button>

          {/* 语音速记（S9 占位） */}
          <button
            disabled
            className="flex-1 py-2 text-xs font-medium rounded-xl
                       bg-surface-overlay text-content-tertiary opacity-50
                       cursor-not-allowed relative"
          >
            🎤 语音速记
            <span className="ml-1 text-[9px] font-bold text-amber-600">🚧S9</span>
          </button>

          {/* 拍小票（S9 占位） */}
          <button
            disabled
            className="flex-1 py-2 text-xs font-medium rounded-xl
                       bg-surface-overlay text-content-tertiary opacity-50
                       cursor-not-allowed"
          >
            📸 拍小票
            <span className="ml-1 text-[9px] font-bold text-amber-600">🚧S9</span>
          </button>
        </div>

        {/* ── 手写录入表单 ────────────────────────────── */}
        {activeTab === 'manual' && (
          <div className="px-5 pb-6 space-y-4">

            {/* 收支类型切换 */}
            <div className="flex gap-2 p-1 bg-surface-overlay rounded-xl">
              {([
                ['expense',  '💸 支出',  'text-rose-600',    'bg-white'],
                ['income',   '💰 收入',  'text-emerald-600', 'bg-white'],
                ['expected', '📅 预支出','text-amber-600',   'bg-white'],
              ] as const).map(([type, label, textCls, activeBg]) => (
                <button
                  key={type}
                  onClick={() => setTxType(type)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    txType === type
                      ? `${activeBg} ${textCls} shadow-sm`
                      : 'text-content-tertiary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 金额输入（大字号，核心体验） */}
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2
                               text-2xl font-bold text-content-tertiary">
                {txType === 'income' ? '+¥' : '-¥'}
              </span>
              <input
                ref={amountRef}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amountStr}
                onChange={e => { setAmountStr(e.target.value); setErrorMsg('') }}
                className="w-full pl-14 pr-4 py-4 text-3xl font-bold tabular-nums
                           bg-gray-50 rounded-2xl border-2 border-transparent
                           focus:border-primary-300 focus:bg-white
                           outline-none transition-all text-content-primary
                           placeholder:text-gray-300"
              />
            </div>

            {/* 分类标签选择 */}
            <div>
              <p className="text-xs font-semibold text-content-secondary mb-2">分类</p>
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium
                                transition-all border ${
                      category === cat
                        ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                        : 'bg-surface-overlay text-content-secondary border-transparent hover:border-gray-200'
                    }`}
                  >
                    <span>{CATEGORY_ICON[cat] ?? '📋'}</span>
                    <span>{cat}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 日期 */}
            <div>
              <p className="text-xs font-semibold text-content-secondary mb-2">日期</p>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-sm
                           text-content-primary border-2 border-transparent
                           focus:border-primary-300 focus:bg-white outline-none transition-all"
              />
            </div>

            {/* 备注 */}
            <div>
              <p className="text-xs font-semibold text-content-secondary mb-2">备注（选填）</p>
              <input
                type="text"
                placeholder={`${category}消费`}
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={50}
                className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-sm
                           text-content-primary border-2 border-transparent
                           focus:border-primary-300 focus:bg-white outline-none transition-all
                           placeholder:text-gray-300"
              />
            </div>

            {/* 当前账套提示 */}
            <div className="flex items-center gap-1.5 px-3 py-2 bg-primary-50 rounded-xl">
              <span className="text-xs">🗂️</span>
              <p className="text-xs text-primary-700">
                将记入账套：
                <span className="font-semibold ml-1">{activeLedgerId}</span>
              </p>
            </div>

            {/* 错误提示 */}
            {errorMsg && (
              <div className="px-3 py-2 bg-red-50 rounded-xl border border-red-100">
                <p className="text-xs text-red-600">⚠️ {errorMsg}</p>
              </div>
            )}

            {/* 保存按钮 */}
            <button
              onClick={handleSave}
              disabled={submitState === 'saving' || submitState === 'success'}
              className={`w-full py-4 rounded-2xl text-sm font-bold transition-all
                disabled:cursor-not-allowed ${
                submitState === 'success'
                  ? 'bg-emerald-500 text-white'
                  : submitState === 'error'
                  ? 'bg-red-500 text-white'
                  : 'bg-primary-600 text-white hover:bg-primary-700 active:scale-[0.98] shadow-fab'
              }`}
            >
              {submitState === 'saving'  ? '⏳ 正在写入云端…'  :
               submitState === 'success' ? '✅ 已保存！看板正在更新…' :
               submitState === 'error'   ? '❌ 保存失败，点击重试' :
               '💾 保存记账'}
            </button>

          </div>
        )}

      </div>
    </>
  )
}
