// 账单导入弹窗组件
// 提供文本粘贴区 → 解析 → 预览表格 的完整导入流程
// S4 阶段：解析完成后仅预览，S5 接入 Firestore 后实现真正写入

import { useState, useCallback } from 'react'
import { parseBillText, detectSource } from '@/services/parsers'
import type { ParseResult, ParsedTransaction } from '@/types/ParseResult.types'
import { formatAmount } from '@/utils/numberUtils'
import { toChineseDate } from '@/utils/dateUtils'

// ── 分类图标映射（复用 HomePage 的逻辑） ─────────────────────
const CATEGORY_ICON: Record<string, string> = {
  '餐饮': '🍜', '交通': '🚇', '购物': '🛍️', '娱乐': '🎮',
  '医疗': '💊', '居住': '🏠', '教育': '📚', '工资': '💰',
  '副业收入': '💻', '理财收益': '📈', '转账': '↔️', '未分类': '📋',
}

// ── 解析阶段枚举，驱动 UI 状态切换 ──────────────────────────
type Stage = 'input' | 'parsing' | 'preview' | 'done'

interface ImportModalProps {
  isOpen:   boolean       // 弹窗是否显示
  onClose:  () => void    // 关闭回调
}

function ImportModal({ isOpen, onClose }: ImportModalProps) {
  // ── 组件状态 ───────────────────────────────────────────────
  const [stage,       setStage]      = useState<Stage>('input')
  const [inputText,   setInputText]  = useState('')            // 用户粘贴的原始文本
  const [result,      setResult]     = useState<ParseResult | null>(null)
  const [activeTab,   setActiveTab]  = useState<'success' | 'errors' | 'duplicates'>('success')

  // 检测当前粘贴内容的来源（实时反馈给用户）
  const detectedSource = inputText.length > 10 ? detectSource(inputText) : null

  // ── 开始解析 ──────────────────────────────────────────────
  const handleParse = useCallback(() => {
    if (!inputText.trim()) return     // 空文本不处理

    setStage('parsing')               // 切换到解析中状态（触发动画）

    // 用 setTimeout 让 parsing 状态能被渲染出来（解析是同步的，否则 UI 来不及刷新）
    setTimeout(() => {
      const parseResult = parseBillText(inputText)   // 调用解析引擎主入口
      setResult(parseResult)                          // 保存结果
      setStage('preview')                             // 切换到预览状态
      setActiveTab('success')                         // 默认展示成功列表
    }, 150)
  }, [inputText])

  // ── 重置回初始状态 ────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStage('input')
    setInputText('')
    setResult(null)
  }, [])

  // ── 弹窗未打开时不渲染（节省 DOM） ───────────────────────
  if (!isOpen) return null

  return (
    // 遮罩层：点击遮罩关闭弹窗
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* 弹窗主体：移动端从底部弹出（sheet 样式），桌面端居中 */}
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl
                      max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">

        {/* ── 弹窗头部 ──────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border-light flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-content-primary">导入账单</h2>
            <p className="text-xs text-content-tertiary mt-0.5">
              {stage === 'input'   && '粘贴微信或支付宝导出的 CSV 内容'}
              {stage === 'parsing' && '正在解析中...'}
              {stage === 'preview' && result && `识别到 ${result.total} 行，成功 ${result.successCount} 条`}
            </p>
          </div>
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center
                       text-content-tertiary hover:text-content-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* ── 弹窗内容区（可滚动） ──────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ════ 输入阶段 ════ */}
          {stage === 'input' && (
            <div className="p-5 space-y-4">

              {/* 来源识别实时提示 */}
              {detectedSource && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                  ${detectedSource === 'unknown'
                    ? 'bg-yellow-50 text-yellow-700'
                    : 'bg-primary-50 text-primary-700'}`}>
                  <span>
                    {detectedSource === 'wechat'  && '✅ 识别为微信支付账单'}
                    {detectedSource === 'alipay'  && '✅ 识别为支付宝账单'}
                    {detectedSource === 'unknown' && '⚠️ 未能识别来源，请确认是否为标准导出格式'}
                  </span>
                </div>
              )}

              {/* 粘贴文本区域 */}
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={PASTE_PLACEHOLDER}
                className="w-full h-52 px-4 py-3 text-xs font-mono text-content-secondary
                           bg-surface-overlay border border-border rounded-xl resize-none
                           focus:outline-none focus:border-primary-500 focus:ring-1
                           focus:ring-primary-500 placeholder-content-tertiary leading-relaxed"
              />

              {/* 操作说明 */}
              <div className="bg-blue-50 rounded-xl p-4 space-y-1.5">
                <p className="text-xs font-medium text-blue-700">📋 如何导出账单？</p>
                <p className="text-xs text-blue-600">
                  <span className="font-medium">微信：</span>
                  微信 → 我 → 服务 → 钱包 → 账单 → 右上角下载图标 → 下载为 CSV
                </p>
                <p className="text-xs text-blue-600">
                  <span className="font-medium">支付宝：</span>
                  支付宝 → 我的 → 账单 → 右上角 → 开具交易记录证明 → 导出 CSV
                </p>
              </div>
            </div>
          )}

          {/* ════ 解析中 ════ */}
          {stage === 'parsing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="text-4xl animate-spin">⚙️</div>
              <p className="text-sm text-content-secondary">正在解析账单数据...</p>
            </div>
          )}

          {/* ════ 预览阶段 ════ */}
          {stage === 'preview' && result && (
            <div className="p-5 space-y-4">

              {/* 解析结果统计卡片 */}
              <div className="grid grid-cols-3 gap-2">
                {/* 成功条目 */}
                <button
                  onClick={() => setActiveTab('success')}
                  className={`rounded-xl p-3 text-center transition-colors ${
                    activeTab === 'success'
                      ? 'bg-income-bg border-2 border-income'
                      : 'bg-surface-overlay border-2 border-transparent'
                  }`}
                >
                  <p className="text-lg font-bold text-income">{result.success.length}</p>
                  <p className="text-xs text-content-tertiary mt-0.5">解析成功</p>
                </button>
                {/* 失败条目 */}
                <button
                  onClick={() => setActiveTab('errors')}
                  className={`rounded-xl p-3 text-center transition-colors ${
                    activeTab === 'errors'
                      ? 'bg-expense-bg border-2 border-expense'
                      : 'bg-surface-overlay border-2 border-transparent'
                  }`}
                >
                  <p className="text-lg font-bold text-expense">{result.errorCount}</p>
                  <p className="text-xs text-content-tertiary mt-0.5">解析失败</p>
                </button>
                {/* 重复条目 */}
                <button
                  onClick={() => setActiveTab('duplicates')}
                  className={`rounded-xl p-3 text-center transition-colors ${
                    activeTab === 'duplicates'
                      ? 'bg-yellow-50 border-2 border-yellow-400'
                      : 'bg-surface-overlay border-2 border-transparent'
                  }`}
                >
                  <p className="text-lg font-bold text-yellow-500">{result.duplicateCount}</p>
                  <p className="text-xs text-content-tertiary mt-0.5">疑似重复</p>
                </button>
              </div>

              {/* 来源标签 */}
              <div className="flex items-center gap-2">
                <span className="text-xs bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full font-medium">
                  {result.source === 'wechat'  ? '微信支付'  :
                   result.source === 'alipay'  ? '支付宝'   : '未知来源'}
                </span>
                {result.fieldErrorCount > 0 && (
                  <span className="text-xs bg-yellow-50 text-yellow-600 px-2.5 py-1 rounded-full">
                    ⚠ {result.fieldErrorCount} 条有字段错误（已保留，可手动修正）
                  </span>
                )}
              </div>

              {/* 账单预览列表 */}
              <PreviewList
                tab={activeTab}
                result={result}
              />
            </div>
          )}
        </div>

        {/* ── 底部操作按钮 ──────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-border-light flex gap-3 flex-shrink-0">
          {stage === 'input' && (
            <>
              <button onClick={onClose} className="btn-ghost flex-1">取消</button>
              <button
                onClick={handleParse}
                disabled={!inputText.trim()}
                className="btn-primary flex-1"
              >
                开始解析 →
              </button>
            </>
          )}

          {stage === 'preview' && result && (
            <>
              <button onClick={handleReset} className="btn-ghost flex-1">重新粘贴</button>
              <button
                disabled  // S5 阶段接入 Firestore 后启用
                className="btn-primary flex-1 opacity-50 cursor-not-allowed"
                title="S5 阶段接入数据库后启用"
              >
                确认导入 {result.success.length} 条 →
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}

// ── 子组件：预览列表 ──────────────────────────────────────────

interface PreviewListProps {
  tab:    'success' | 'errors' | 'duplicates'
  result: ParseResult
}

function PreviewList({ tab, result }: PreviewListProps) {
  // 根据当前 Tab 选择要展示的数据
  const items = tab === 'errors' ? null : (
    tab === 'success' ? result.success : result.duplicates
  )

  // ── 错误列表 ──────────────────────────────────────────────
  if (tab === 'errors') {
    if (result.errors.length === 0) {
      return <EmptyState icon="✅" text="没有解析失败的行" />
    }
    return (
      <div className="space-y-2">
        {result.errors.map((err, i) => (
          <div key={i} className="bg-expense-bg border border-expense/20 rounded-xl p-3">
            <p className="text-xs font-medium text-expense mb-1">第 {err.rowIndex} 行 — {err.reason}</p>
            <p className="text-xs text-content-tertiary font-mono break-all">{err.rawContent}</p>
          </div>
        ))}
      </div>
    )
  }

  // ── 成功 / 重复列表 ───────────────────────────────────────
  if (!items || items.length === 0) {
    return <EmptyState icon={tab === 'duplicates' ? '✅' : '📭'} text={
      tab === 'duplicates' ? '没有检测到重复条目' : '没有解析成功的条目'
    } />
  }

  return (
    <div className="space-y-0 rounded-xl overflow-hidden border border-border-light">
      {items.map((tx, i) => (
        <TransactionPreviewRow key={i} tx={tx} showDuplicateBadge={tab === 'duplicates'} />
      ))}
    </div>
  )
}

// ── 子组件：单条账单预览行 ────────────────────────────────────

function TransactionPreviewRow({
  tx,
  showDuplicateBadge,
}: {
  tx: ParsedTransaction
  showDuplicateBadge: boolean
}) {
  const icon      = CATEGORY_ICON[tx.category] ?? '📋'
  const isIncome  = (tx.amount ?? 0) > 0
  const hasError  = Boolean(tx.parseError)  // 有字段级解析错误

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border-light last:border-0
                     ${hasError ? 'bg-yellow-50/50' : 'bg-white'}`}>

      {/* 分类图标 */}
      <span className="text-lg flex-shrink-0">{icon}</span>

      {/* 描述 + 分类 + 日期 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium text-content-primary truncate">{tx.description}</p>
          {/* 重复标记徽章 */}
          {showDuplicateBadge && (
            <span className="flex-shrink-0 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">
              疑似重复
            </span>
          )}
          {/* 字段错误标记 */}
          {hasError && (
            <span className="flex-shrink-0 text-[10px] bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded-full">
              ⚠ {tx.parseError}
            </span>
          )}
        </div>
        <p className="text-[10px] text-content-tertiary mt-0.5">
          <span>{tx.category}</span>
          <span className="mx-1 opacity-40">·</span>
          <span>{tx.date ? toChineseDate(tx.date) : '日期未知'}</span>
          <span className="mx-1 opacity-40">·</span>
          <span>{tx.source === 'wechat' ? '微信' : '支付宝'}</span>
        </p>
      </div>

      {/* 金额 */}
      <div className="flex-shrink-0 text-right">
        {tx.amount !== null ? (
          <span className={`text-xs font-semibold tabular-nums ${
            isIncome ? 'text-income' : 'text-content-primary'
          }`}>
            {isIncome ? '+' : '-'}¥{formatAmount(Math.abs(tx.amount))}
          </span>
        ) : (
          <span className="text-xs text-yellow-500 font-medium">金额未知</span>
        )}
      </div>
    </div>
  )
}

// ── 子组件：空状态占位 ────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-3xl mb-2">{icon}</p>
      <p className="text-sm text-content-tertiary">{text}</p>
    </div>
  )
}

// ── 文本区占位提示（多行字符串单独抽出，避免 JSX 行过长） ───
const PASTE_PLACEHOLDER = `在此粘贴微信或支付宝导出的 CSV 文件内容...

示例（微信账单第17行起）：
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,备注
2026-03-15 12:30:00,商户消费,美团,黄焖鸡米饭,支出,¥38.50,零钱,支付成功,/`

export default ImportModal
