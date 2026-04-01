// 纠偏策略选择弹窗
// 当用户修改账单的分类/账户等字段时弹出，询问此次修改的影响范围
// 对应战略支柱①：补录纠偏 + 溯及既往

import { useState } from 'react'
import type { CorrectionPolicy } from '@/types/Transaction.types'

// ── 每个策略选项的完整描述数据 ──────────────────────────────
interface PolicyOption {
  key:          CorrectionPolicy
  icon:         string
  title:        string
  subtitle:     string
  description:  string
  badge?:       string
  isDanger:     boolean
  // 激活态样式
  borderActive: string
  bgActive:     string
  iconBg:       string
  radioActive:  string
}

const POLICY_OPTIONS: PolicyOption[] = [
  {
    key:         'once',
    icon:        '📌',
    title:       '仅限本次',
    subtitle:    '只影响当前这一条',
    description: '只修改当前这一条账单记录，不影响历史和未来的任何其他记录。',
    isDanger:    false,
    borderActive: 'border-primary-400',
    bgActive:     'bg-primary-50',
    iconBg:       'bg-primary-100',
    radioActive:  'border-primary-500 bg-primary-500',
  },
  {
    key:         'rule_forward',
    icon:        '⚙️',
    title:       '创建规则',
    subtitle:    '前向生效，不影响历史',
    description: '以此次修改为规则，下次导入相同商户/描述时自动应用这个分类或账户，不改动过去的记录。',
    badge:       '推荐',
    isDanger:    false,
    borderActive: 'border-amber-400',
    bgActive:     'bg-amber-50',
    iconBg:       'bg-amber-100',
    radioActive:  'border-amber-500 bg-amber-500',
  },
  {
    key:         'retroactive',
    icon:        '⚠️',
    title:       '溯及既往',
    subtitle:    '全量修改历史匹配记录',
    description: '同时修改历史上所有"描述相似且原分类相同"的账单。此操作范围广、不可撤销，请谨慎执行。',
    badge:       '高危操作',
    isDanger:    true,
    borderActive: 'border-red-400',
    bgActive:     'bg-red-50/80',
    iconBg:       'bg-red-100',
    radioActive:  'border-red-500 bg-red-500',
  },
]

// ── 组件 Props ────────────────────────────────────────────────
export interface CorrectionPolicyModalProps {
  isOpen:    boolean
  onClose:   () => void
  /** 返回 Promise — 弹窗在 await 期间保持打开并显示 ⏳ Loading 态 */
  onConfirm: (policy: CorrectionPolicy) => Promise<void>
  // 修改上下文（可选，用于展示"你正在改什么"）
  field?:    string   // 被修改的字段，如"分类"
  oldValue?: string   // 修改前的值，如"未分类"
  newValue?: string   // 修改后的值，如"餐饮"
}

// ── 主组件 ────────────────────────────────────────────────────
function CorrectionPolicyModal({
  isOpen,
  onClose,
  onConfirm,
  field    = '分类',
  oldValue = '未分类',
  newValue = '餐饮',
}: CorrectionPolicyModalProps) {
  // 当前选中的策略
  const [selected,     setSelected]     = useState<CorrectionPolicy | null>(null)
  // Firestore 写入期间锁定按钮，避免重复提交
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 弹窗关闭时重置选择（提交中禁止关闭）
  function handleClose() {
    if (isSubmitting) return
    setSelected(null)
    onClose()
  }

  async function handleConfirm() {
    if (!selected || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onConfirm(selected)   // 等待 Firestore 写入完成（含批量 writeBatch）
    } finally {
      setIsSubmitting(false)
      setSelected(null)
      onClose()
    }
  }

  if (!isOpen) return null

  const selectedOption = POLICY_OPTIONS.find(o => o.key === selected)
  const isDangerSelected = selectedOption?.isDanger ?? false

  return (
    // ── 遮罩层（点击遮罩关闭） ──────────────────────────────
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">

      {/* 毛玻璃遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      {/* ── 弹窗主体 ──────────────────────────────────────── */}
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* ── 顶部把手（移动端上拉感） ──────────────────────── */}
        <div className="flex justify-center pt-3 pb-0 sm:hidden">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* ── 标题区 ────────────────────────────────────────── */}
        <div className="px-5 pt-4 pb-4 border-b border-border-light">
          <div className="flex items-start justify-between">
            <div>
              {/* 标题 */}
              <h2 className="text-base font-bold text-content-primary">
                选择修改范围
              </h2>
              {/* 修改上下文说明 */}
              <div className="flex items-center flex-wrap gap-1 mt-1.5">
                <span className="text-xs text-content-tertiary">修改</span>
                <span className="text-xs font-semibold text-content-secondary px-1.5 py-0.5 bg-surface-overlay rounded">
                  {field}
                </span>
                {/* 旧值 */}
                <span className="text-xs text-content-tertiary line-through opacity-60">
                  {oldValue}
                </span>
                {/* 箭头 */}
                <svg className="w-3 h-3 text-content-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                {/* 新值 */}
                <span className="text-xs font-semibold text-primary-600 px-1.5 py-0.5 bg-primary-50 rounded">
                  {newValue}
                </span>
              </div>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={handleClose}
              className="w-7 h-7 rounded-full bg-surface-overlay flex items-center justify-center
                         text-content-tertiary hover:text-content-primary hover:bg-gray-100
                         transition-colors flex-shrink-0 ml-3 mt-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── 三个策略选项 ────────────────────────────────────── */}
        <div className="px-4 pt-3.5 pb-2 flex flex-col gap-2.5">
          {POLICY_OPTIONS.map(option => {
            const isSelected = selected === option.key

            return (
              <button
                key={option.key}
                onClick={() => setSelected(option.key)}
                className={`
                  w-full rounded-2xl border-2 p-3.5 text-left
                  transition-all duration-150
                  ${isSelected
                    ? `${option.borderActive} ${option.bgActive}`
                    : 'border-border hover:border-gray-300 bg-white'
                  }
                  ${option.isDanger && isSelected ? 'ring-2 ring-red-100' : ''}
                `}
              >
                <div className="flex items-start gap-3">

                  {/* 图标 */}
                  <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0
                    ${option.iconBg}
                  `}>
                    {option.icon}
                  </div>

                  {/* 文字区 */}
                  <div className="flex-1 min-w-0">
                    {/* 标题行 + 徽章 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`
                        text-sm font-bold
                        ${option.isDanger ? 'text-red-700' : 'text-content-primary'}
                      `}>
                        {option.title}
                      </span>
                      {option.badge && (
                        <span className={`
                          text-[10px] font-bold px-1.5 py-0.5 rounded-full
                          ${option.isDanger
                            ? 'bg-red-100 text-red-600'
                            : 'bg-amber-100 text-amber-700'
                          }
                        `}>
                          {option.badge}
                        </span>
                      )}
                    </div>
                    {/* 副标题 */}
                    <p className={`
                      text-[11px] font-medium mt-0.5
                      ${option.isDanger ? 'text-red-400' : 'text-content-tertiary'}
                    `}>
                      {option.subtitle}
                    </p>
                    {/* 详细描述 */}
                    <p className={`
                      text-xs mt-1.5 leading-relaxed
                      ${option.isDanger ? 'text-red-500' : 'text-content-tertiary'}
                    `}>
                      {option.description}
                    </p>

                    {/* 高危操作额外警告条（仅"溯及既往"展开时显示） */}
                    {option.isDanger && isSelected && (
                      <div className="mt-2.5 flex items-start gap-1.5 bg-red-100/70 rounded-xl px-3 py-2">
                        <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <p className="text-[11px] text-red-600 font-medium leading-relaxed">
                          此操作将批量修改历史账单，执行后无法还原，请确认你的意图。
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 单选圆点 */}
                  <div className={`
                    w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5
                    flex items-center justify-center transition-all
                    ${isSelected ? option.radioActive : 'border-gray-300 bg-white'}
                  `}>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>

                </div>
              </button>
            )
          })}
        </div>

        {/* ── 底部操作按钮 ──────────────────────────────────── */}
        <div className="px-4 pt-2 pb-5 flex gap-3">

          {/* 取消 */}
          <button
            onClick={handleClose}
            className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold
                       text-content-secondary bg-white hover:bg-surface-overlay
                       transition-colors"
          >
            取消
          </button>

          {/* 确认（未选择时禁用；选中高危时变红；提交中显示 ⏳） */}
          <button
            onClick={handleConfirm}
            disabled={!selected || isSubmitting}
            className={`
              flex-[2] py-3 rounded-xl text-sm font-bold text-white
              transition-all duration-200
              ${!selected || isSubmitting
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : isDangerSelected
                  ? 'bg-red-500 hover:bg-red-600 shadow-[0_4px_16px_rgba(239,68,68,0.40)]'
                  : 'bg-primary-500 hover:bg-primary-600 shadow-[0_4px_16px_rgba(20,184,166,0.35)]'
              }
            `}
          >
            {/* 提交中：旋转等待 */}
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-1.5">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                写入云端…
              </span>
            ) : isDangerSelected ? (
              /* 高危操作显示警告图标 */
              <span className="flex items-center justify-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                确认（不可撤销）
              </span>
            ) : (
              '确认'
            )}
          </button>

        </div>
      </div>
    </div>
  )
}

export default CorrectionPolicyModal
