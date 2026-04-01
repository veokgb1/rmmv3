// OmniInputModal — 全能记账舱 (S8 手写 / S10 视觉 / S11 智能识别)
// 底部滑入抽屉，三大引擎全部点亮：
//   ✍️ 手写录入    — 表单手动填写（默认）
//   📸 拍小票      — Gemini 2.5 Flash Vision 单条识别
//   ✨ 智能识别    — 长文本/语音 → Gemini 批量提取 → 审核舱确认 → writeBatch 一键入账
//
// 布局架构（S13 全局重构）：三段式 Flex
//   ① Header  flex-shrink-0   — 把手 + 标题 + Tab 切换栏，固定不参与滚动
//   ② Body    flex-1 min-h-0  — 各 Tab 内容区，内部独立滚动
//   ③ Footer  flex-shrink-0   — 操作按钮，永远悬浮贴底，不被内容遮挡
//
// 铁律：保存成功后绝不手动操作 Store，依赖 onSnapshot 单向数据流驱动 UI 重绘

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  collection, writeBatch, doc, serverTimestamp,
} from 'firebase/firestore'
import { db }                  from '@/config/firebase'
import { addTransaction }      from '@/services/firebase/billService'
import {
  analyzeReceipt,
  parseNaturalLanguageBatch,
}                              from '@/services/aiService'
import { useLedgerStore }      from '@/store/ledgerStore'
import type { SystemCategory } from '@/types/Category.types'
import type { Transaction }    from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// 分类常量
// ─────────────────────────────────────────────────────────────
const ALL_CATEGORIES: SystemCategory[] = [
  '餐饮','交通','购物','娱乐','医疗','居住','教育',
  '工资','副业收入','理财收益','转账','未分类',
]
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
// 工具函数
// ─────────────────────────────────────────────────────────────
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// ─────────────────────────────────────────────────────────────
// Web Speech API 类型声明（浏览器标准 API，TypeScript 未内置完整定义）
// ─────────────────────────────────────────────────────────────
interface ISpeechRecognitionEvent extends Event {
  resultIndex: number
  results:     SpeechRecognitionResultList
}
interface ISpeechRecognitionErrorEvent extends Event {
  error:   string
  message: string
}
interface ISpeechRecognition extends EventTarget {
  lang:           string
  continuous:     boolean
  interimResults: boolean
  start():        void
  stop():         void
  abort():        void
  onresult:       ((ev: ISpeechRecognitionEvent) => void)        | null
  onend:          ((ev: Event) => void)                           | null
  onerror:        ((ev: ISpeechRecognitionErrorEvent) => void)    | null
}
interface ISpeechRecognitionCtor {
  new (): ISpeechRecognition
}

// ─────────────────────────────────────────────────────────────
// 浏览器 SpeechRecognition 兼容性检测（标准 + webkit 前缀）
// ─────────────────────────────────────────────────────────────
const win = typeof window !== 'undefined'
  ? (window as unknown as Record<string, ISpeechRecognitionCtor | undefined>)
  : undefined

const SpeechRecognitionCtor: ISpeechRecognitionCtor | undefined =
  win?.['SpeechRecognition'] ?? win?.['webkitSpeechRecognition']

const isSpeechSupported = !!SpeechRecognitionCtor

// ─────────────────────────────────────────────────────────────
// 审核卡片数据结构（支持用户内联编辑）
// ─────────────────────────────────────────────────────────────
interface DraftItem {
  /** 本地唯一 ID，用于列表 key 和删除操作 */
  _id:      string
  amount:   number
  category: SystemCategory
  date:     string
  notes:    string
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface OmniInputModalProps {
  isOpen:     boolean
  onClose:    () => void
  showToast?: (msg: string, type?: 'success' | 'warning' | 'error') => void
}

// ─────────────────────────────────────────────────────────────
// OCR 状态机（拍小票 Tab，S10 不变）
// ─────────────────────────────────────────────────────────────
type OcrState = 'idle' | 'preview' | 'analyzing' | 'done' | 'error'

const ANALYZING_TEXTS = [
  '🤖 Gemini 正在解析小票的灵魂…',
  '🔍 识别金额与商家信息中…',
  '🧠 AI 思考最适合的分类…',
  '✨ 即将为你自动填写表单…',
]

// ─────────────────────────────────────────────────────────────
// 智能识别状态机（S11 新 Tab）
// input     → 用户在 textarea 输入（含语音追加）
// parsing   → Gemini 批量解析中
// review    → 显示审核卡片列表，等待用户确认/编辑/删除
// saving    → writeBatch 写入 Firestore 中
// done      → 写入完成（关闭弹窗，onSnapshot 驱动更新）
// error     → 解析或写入失败
// ─────────────────────────────────────────────────────────────
type SmartState = 'input' | 'parsing' | 'review' | 'saving' | 'done' | 'error'

// ─────────────────────────────────────────────────────────────
// 子组件：单条审核卡片（内联可编辑）
// ─────────────────────────────────────────────────────────────
interface DraftCardProps {
  item:     DraftItem
  index:    number
  onChange: (id: string, field: keyof Omit<DraftItem, '_id'>, value: string | number) => void
  onRemove: (id: string) => void
}

function DraftCard({ item, index, onChange, onRemove }: DraftCardProps) {
  return (
    <div className="bg-white rounded-2xl border-2 border-gray-100 p-4 space-y-3
                    shadow-[0_2px_8px_rgba(0,0,0,0.06)]">

      {/* 卡片头：序号 + 删除按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700
                           text-[11px] font-bold flex items-center justify-center">
            {index + 1}
          </span>
          <span className="text-xs font-semibold text-content-secondary">
            {CATEGORY_ICON[item.category] ?? '📋'} {item.category}
          </span>
        </div>
        <button
          onClick={() => onRemove(item._id)}
          className="w-7 h-7 rounded-full bg-red-50 text-red-400
                     flex items-center justify-center text-xs
                     hover:bg-red-100 hover:text-red-600 transition-colors"
          title="移除此条"
        >
          🗑️
        </button>
      </div>

      {/* 金额（大字醒目） */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2
                         text-lg font-bold text-content-tertiary">-¥</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={item.amount}
          onChange={e => onChange(item._id, 'amount', parseFloat(e.target.value) || 0)}
          className="w-full pl-10 pr-4 py-2.5 text-xl font-bold tabular-nums
                     bg-gray-50 rounded-xl border-2 border-transparent
                     focus:border-primary-300 focus:bg-white outline-none transition-all
                     text-content-primary"
        />
      </div>

      {/* 分类选择器 */}
      <select
        value={item.category}
        onChange={e => onChange(item._id, 'category', e.target.value)}
        className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm text-content-primary
                   border-2 border-transparent focus:border-primary-300 focus:bg-white
                   outline-none transition-all"
      >
        {ALL_CATEGORIES.map(cat => (
          <option key={cat} value={cat}>{CATEGORY_ICON[cat]} {cat}</option>
        ))}
      </select>

      {/* 日期 + 备注（两列并排） */}
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={item.date}
          onChange={e => onChange(item._id, 'date', e.target.value)}
          className="px-3 py-2 bg-gray-50 rounded-xl text-xs text-content-primary
                     border-2 border-transparent focus:border-primary-300
                     focus:bg-white outline-none transition-all"
        />
        <input
          type="text"
          value={item.notes}
          placeholder="备注"
          maxLength={30}
          onChange={e => onChange(item._id, 'notes', e.target.value)}
          className="px-3 py-2 bg-gray-50 rounded-xl text-xs text-content-primary
                     border-2 border-transparent focus:border-primary-300
                     focus:bg-white outline-none transition-all
                     placeholder:text-gray-300"
        />
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 子组件：智能识别 Tab（S11 核心）
// 架构：统一根容器 flex flex-col flex-1 min-h-0
//   Review 态 → 内部三段式（标题固定 / 卡片滚动 / 双按钮固定）
//   其他态    → 单一弹性滚动区
// ─────────────────────────────────────────────────────────────
interface SmartPanelProps {
  activeLedgerId: string
  onClose:        () => void
  showToast?:     (msg: string, type?: 'success' | 'warning' | 'error') => void
}

function SmartPanel({ activeLedgerId, onClose, showToast }: SmartPanelProps) {
  const [smartState,  setSmartState]  = useState<SmartState>('input')
  const [inputText,   setInputText]   = useState('')
  const [drafts,      setDrafts]      = useState<DraftItem[]>([])
  const [smartError,  setSmartError]  = useState('')
  const [isSaving,    setIsSaving]    = useState(false)

  // ── 语音识别状态（作为 textarea 的输入辅助）────────────
  const [isListening,  setIsListening]  = useState(false)
  const [voiceInterim, setVoiceInterim] = useState('')   // 实时临时结果
  const [voiceSeconds, setVoiceSeconds] = useState(60)   // 60 秒倒计时
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const countdownRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── 组件卸载时释放麦克风 + 清定时器 ──────────────────────
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  // ── 倒计时 effect：isListening=true 时每秒 -1，归零自动停止 ──
  useEffect(() => {
    if (!isListening) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
      setVoiceSeconds(60)
      return
    }
    countdownRef.current = setInterval(() => {
      setVoiceSeconds(prev => {
        if (prev <= 1) { recognitionRef.current?.stop(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    }
  }, [isListening])

  // ── 语音录入：显式切换开关（第一次点击=开始，第二次点击=停止）──
  function toggleVoice() {
    if (isListening) { stopVoice(); return }
    startVoice()
  }

  function startVoice() {
    if (!SpeechRecognitionCtor || isListening) return
    const recognition = new SpeechRecognitionCtor()
    recognitionRef.current = recognition
    recognition.lang           = 'zh-CN'
    recognition.continuous     = true   // 持续录音，不自动打断
    recognition.interimResults = true

    recognition.onresult = (event: ISpeechRecognitionEvent) => {
      let interim = ''
      let final   = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) final   += r[0].transcript
        else           interim += r[0].transcript
      }
      setVoiceInterim(interim)
      if (final) {
        setInputText(prev => {
          const sep = prev.trim() ? '，' : ''
          return prev + sep + final
        })
        setVoiceInterim('')
      }
    }
    recognition.onend  = () => { setIsListening(false); setVoiceInterim('') }
    recognition.onerror = (e: ISpeechRecognitionErrorEvent) => {
      setIsListening(false)
      setVoiceInterim('')
      if (e.error !== 'aborted') showToast?.('语音识别出错，请检查麦克风权限', 'warning')
    }
    setIsListening(true)
    recognition.start()
  }

  function stopVoice() {
    recognitionRef.current?.stop()
    setIsListening(false)
  }

  // ── 触发 Gemini 批量解析 ────────────────────────────────
  async function handleParse() {
    const text = inputText.trim()
    if (!text) { showToast?.('请先输入或说出消费记录', 'warning'); return }
    setSmartState('parsing')
    setSmartError('')
    try {
      const results = await parseNaturalLanguageBatch(text)
      if (results.length === 0) {
        setSmartError('AI 未能从文本中识别出任何消费记录，请检查内容后重试')
        setSmartState('error')
        return
      }
      const draftItems: DraftItem[] = results.map((r, i) => ({
        _id:      `draft-${Date.now()}-${i}`,
        amount:   r.amount,
        category: r.category,
        date:     r.date,
        notes:    r.notes,
      }))
      setDrafts(draftItems)
      setSmartState('review')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 解析失败'
      setSmartError(msg)
      setSmartState('error')
      showToast?.('AI 暂时打了个盹，请重试', 'warning')
    }
  }

  // ── 内联编辑：修改某条草稿的某个字段 ───────────────────
  const handleCardChange = useCallback((
    id:    string,
    field: keyof Omit<DraftItem, '_id'>,
    value: string | number,
  ) => {
    setDrafts(prev => prev.map(d => d._id === id ? { ...d, [field]: value } : d))
  }, [])

  // ── 移除某条草稿 ────────────────────────────────────────
  const handleCardRemove = useCallback((id: string) => {
    setDrafts(prev => prev.filter(d => d._id !== id))
  }, [])

  // ── writeBatch 批量写入 Firestore ───────────────────────
  // 铁律：仅写 Firestore，不手动操作 billStore，onSnapshot 驱动 UI 重绘
  async function handleBatchSave() {
    const valid = drafts.filter(d => d.amount > 0)
    if (valid.length === 0) { showToast?.('没有可入账的记录', 'warning'); return }
    setIsSaving(true)
    setSmartState('saving')
    try {
      const batch = writeBatch(db)
      const txCol = collection(db, 'transactions')
      for (const item of valid) {
        const newRef = doc(txCol)
        const txData: Omit<Transaction, 'id'> = {
          ledgerId:         activeLedgerId,
          userId:           'mock-user',
          date:             item.date,
          amount:           -Math.abs(item.amount),
          category:         item.category,
          description:      item.notes || item.category,
          source:           'manual',
          sourceType:       'manual',
          status:           'cleared',
          tags:             [],
          accountId:        'acc-manual',
          rawData:          {},
          isManuallyEdited: false,
          createdAt:        serverTimestamp() as unknown as number,
          updatedAt:        serverTimestamp() as unknown as number,
        }
        batch.set(newRef, txData)
      }
      await batch.commit()
      showToast?.(`✅ 已批量入账 ${valid.length} 条记录`, 'success')
      setSmartState('done')
      setTimeout(() => onClose(), 800)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Firestore 写入失败'
      setSmartError(msg)
      setSmartState('review')   // 退回审核态，不丢草稿
      showToast?.('批量入账失败，请重试', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // ── 重置为输入态 ────────────────────────────────────────
  function handleReset() {
    recognitionRef.current?.abort()
    setSmartState('input')
    setInputText('')
    setDrafts([])
    setSmartError('')
    setVoiceInterim('')
    setIsListening(false)
  }

  // done 态：父组件正在关闭，不渲染
  if (smartState === 'done') return null

  const remaining = drafts.length

  // ──────────────────────────────────────────────────────────
  // 统一根容器：flex flex-col flex-1 min-h-0
  //   充满父级 Body 区域，各状态内部自行决定滚动与固定策略
  // ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Input 态：单一弹性滚动区 ──────────────────────── */}
      {smartState === 'input' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6 space-y-4">

          {/* textarea 主输入区 */}
          <div className="relative">
            <textarea
              value={inputText + (voiceInterim ? `\n[识别中：${voiceInterim}]` : '')}
              onChange={e => setInputText(e.target.value)}
              placeholder={`粘贴或输入消费记录，支持多笔…\n\n例如：\n昨天打车35，中午外卖28.5\n下午买了杯奶茶20，书费150`}
              rows={6}
              className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm text-content-primary
                         border-2 border-transparent focus:border-primary-300 focus:bg-white
                         outline-none transition-all resize-none leading-relaxed
                         placeholder:text-gray-300"
            />
            <span className="absolute bottom-3 right-3 text-[10px] text-content-tertiary">
              {inputText.length} 字
            </span>
          </div>

          {/* 语音辅助输入行 */}
          <div className="flex items-center gap-2">
            {isSpeechSupported ? (
              <>
                <button
                  onClick={toggleVoice}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                              transition-all ${
                    isListening
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-100 text-content-secondary hover:bg-gray-200'
                  }`}
                >
                  🎤
                  <span>{isListening ? '点击停止' : '语音追加'}</span>
                  {isListening && (
                    <span className={`ml-1 font-bold tabular-nums ${
                      voiceSeconds < 10 ? 'text-yellow-200' : 'text-red-100'
                    }`}>
                      {voiceSeconds}s
                    </span>
                  )}
                </button>
                {isListening && (
                  <span className={`text-[11px] animate-pulse ${
                    voiceSeconds < 10 ? 'text-red-500 font-semibold' : 'text-red-400'
                  }`}>
                    {voiceSeconds < 10 ? '⚠️ 即将自动停止' : '正在聆听…'}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-content-tertiary">
                （当前浏览器不支持语音输入）
              </span>
            )}
            {inputText && (
              <button
                onClick={() => { setInputText(''); setVoiceInterim('') }}
                className="ml-auto text-[11px] text-content-tertiary
                           hover:text-red-400 transition-colors"
              >
                清空
              </button>
            )}
          </div>

          {/* 示例提示卡 */}
          <div className="bg-primary-50 rounded-2xl px-4 py-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-primary-700">💡 支持以下输入格式：</p>
            {[
              '「昨天打车35，中午外卖28.5，买奶茶20」',
              '「本月房租5500，水电费200，宽带99」',
              '粘贴微信/支付宝账单截图中的文字内容',
            ].map(ex => (
              <p key={ex} className="text-[11px] text-primary-500 flex gap-1">
                <span className="opacity-60">▸</span>
                <span>{ex}</span>
              </p>
            ))}
          </div>

          {/* 主操作按钮 */}
          <button
            onClick={handleParse}
            disabled={!inputText.trim()}
            className="w-full py-4 rounded-2xl text-sm font-bold
                       bg-gradient-to-r from-primary-600 to-primary-500 text-white
                       hover:from-primary-700 hover:to-primary-600 shadow-fab
                       active:scale-[0.98] transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            🤖 智能提取账单
          </button>

        </div>
      )}

      {/* ── Parsing 态：居中 Loading ─────────────────────── */}
      {smartState === 'parsing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-5 py-8">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-primary-200
                            border-t-primary-500 animate-spin" />
            <div className="absolute inset-2 rounded-full bg-primary-50
                            flex items-center justify-center text-2xl">🤖</div>
          </div>
          <div className="text-center space-y-1.5">
            <p className="text-sm font-semibold text-content-primary">
              Gemini 正在批量解析账单…
            </p>
            <p className="text-xs text-content-tertiary">
              正在识别文本中的每一笔消费记录
            </p>
          </div>
          <div className="flex gap-1.5">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-primary-400 animate-bounce"
                style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
          <p className="text-[11px] text-content-tertiary">通常 2-6 秒完成 · 文本越长耗时越久</p>
        </div>
      )}

      {/* ── Review / Saving 态：三段式内部布局 ─────────────
            ① 审核标题栏  flex-shrink-0  固定
            ② 卡片列表    flex-1 scroll  弹性滚动
            ③ 双操作按钮  flex-shrink-0  固定悬浮
      ─────────────────────────────────────────────────── */}
      {(smartState === 'review' || smartState === 'saving') && (
        <>
          {/* ① 审核舱标题栏（固定） */}
          <div className="flex-shrink-0 px-5 py-3 bg-emerald-50 border-b border-emerald-100
                          flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-xs font-bold
                               flex items-center justify-center">
                {remaining}
              </span>
              <p className="text-sm font-semibold text-emerald-800">
                成功识别出 {remaining} 条账单
              </p>
            </div>
            <p className="text-[11px] text-emerald-600">点卡片可编辑</p>
          </div>

          {/* ② 可滚动的审核卡片列表（弹性占满剩余高度） */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-3 space-y-3">
            {drafts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-content-tertiary">所有条目已移除</p>
                <button
                  onClick={handleReset}
                  className="mt-3 text-xs text-primary-600 font-semibold"
                >
                  重新输入
                </button>
              </div>
            ) : (
              drafts.map((item, index) => (
                <DraftCard
                  key={item._id}
                  item={item}
                  index={index}
                  onChange={handleCardChange}
                  onRemove={handleCardRemove}
                />
              ))
            )}
          </div>

          {/* 写入失败错误条（固定在按钮上方） */}
          {smartError && (
            <div className="flex-shrink-0 mx-5 px-3 py-2 bg-red-50 rounded-xl border border-red-100">
              <p className="text-xs text-red-600">⚠️ {smartError}</p>
            </div>
          )}

          {/* ③ 底部双按钮（固定悬浮，永不被卡片遮挡） */}
          <div className="flex-shrink-0 px-5 pt-3 pb-6
                          bg-white border-t border-gray-100
                          shadow-[0_-4px_16px_rgba(0,0,0,0.06)]
                          flex gap-3">
            {/* 🚫 重来 */}
            <button
              onClick={handleReset}
              disabled={isSaving}
              className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-sm font-semibold
                         text-content-secondary hover:bg-gray-50 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🚫 重来
            </button>
            {/* 💾 确认入账 */}
            <button
              onClick={handleBatchSave}
              disabled={isSaving || drafts.length === 0}
              className="flex-[2] py-3 rounded-xl text-sm font-bold text-white
                         bg-primary-600 hover:bg-primary-700 shadow-fab
                         active:scale-[0.98] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>写入云端…</span>
                </>
              ) : (
                <span>💾 确认入账 ({remaining} 条)</span>
              )}
            </button>
          </div>
        </>
      )}

      {/* ── Error 态：单一弹性滚动区 ─────────────────────── */}
      {smartState === 'error' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6 space-y-4">
          <div className="text-center py-6">
            <div className="text-4xl mb-3">😵</div>
            <p className="text-sm font-semibold text-content-primary mb-1">AI 暂时打了个盹</p>
            <p className="text-xs text-content-tertiary leading-relaxed max-w-xs mx-auto">
              {smartError}
            </p>
          </div>
          <button
            onClick={handleReset}
            className="w-full py-3 rounded-xl bg-primary-600 text-white
                       text-sm font-semibold hover:bg-primary-700 transition-colors"
          >
            🔄 重新输入
          </button>
        </div>
      )}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 子组件：拍小票 Tab（S10）
// 架构：统一根容器 flex flex-col flex-1 min-h-0，各状态内部弹性滚动
// ─────────────────────────────────────────────────────────────
interface OcrPanelProps {
  onFillForm: (amount: number, category: SystemCategory, date: string, notes: string) => void
  showToast?: (msg: string, type?: 'success' | 'warning' | 'error') => void
}

function OcrPanel({ onFillForm, showToast }: OcrPanelProps) {
  const [ocrState,     setOcrState]     = useState<OcrState>('idle')
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)
  const [base64Data,   setBase64Data]   = useState('')
  const [mimeType,     setMimeType]     = useState('image/jpeg')
  const [ocrError,     setOcrError]     = useState('')
  const [analyzingIdx, setAnalyzingIdx] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ocrState !== 'analyzing') return
    const id = setInterval(() => setAnalyzingIdx(i => (i + 1) % ANALYZING_TEXTS.length), 1800)
    return () => clearInterval(id)
  }, [ocrState])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 4 * 1024 * 1024) { setOcrError('图片过大（≤4MB）'); setOcrState('error'); return }
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      setPreviewUrl(dataUrl)
      const [header, b64] = dataUrl.split(',')
      setBase64Data(b64)
      setMimeType(header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg')
      setOcrState('preview'); setOcrError('')
    }
    reader.readAsDataURL(file); e.target.value = ''
  }

  async function handleAnalyze() {
    if (!base64Data) return
    setOcrState('analyzing'); setAnalyzingIdx(0)
    try {
      const result = await analyzeReceipt(base64Data, mimeType)
      onFillForm(result.amount, result.category, result.date, result.notes)
      setOcrState('done')
      showToast?.('✨ AI 识别成功，已自动填写表单！', 'success')
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '识别失败')
      setOcrState('error')
      showToast?.('AI 暂时打了个盹，请重试', 'warning')
    }
  }

  function handleReset() {
    setOcrState('idle'); setPreviewUrl(null); setBase64Data(''); setOcrError('')
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* idle 态 */}
      {ocrState === 'idle' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6">
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
            onChange={handleFileChange} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-primary-200 rounded-2xl
                       bg-primary-50/40 hover:bg-primary-50 hover:border-primary-300
                       transition-all py-10 flex flex-col items-center gap-3 group active:scale-[0.98]"
          >
            <div className="w-16 h-16 rounded-2xl bg-white shadow-card flex items-center justify-center text-3xl
                            group-hover:shadow-card-md transition-all">📸</div>
            <div className="text-center">
              <p className="text-sm font-bold text-content-primary">拍照 / 选择小票图片</p>
              <p className="text-xs text-content-tertiary mt-1">图片大小 ≤ 4MB · JPG / PNG / HEIC</p>
            </div>
          </button>
          <div className="mt-3 px-3 py-2.5 bg-amber-50 rounded-xl border border-amber-100 flex items-start gap-2">
            <span className="text-base flex-shrink-0 mt-0.5">⚡</span>
            <p className="text-[11px] text-amber-600 leading-relaxed">
              <span className="font-semibold text-amber-800">Gemini 2.5 Flash </span>
              视觉识别 · 自动填写金额、分类、日期和备注
            </p>
          </div>
        </div>
      )}

      {/* preview 态 */}
      {ocrState === 'preview' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6 space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-gray-100 shadow-card">
            <img src={previewUrl!} alt="小票预览" className="w-full max-h-48 object-contain" />
            <button
              onClick={handleReset}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 text-white text-xs
                         flex items-center justify-center hover:bg-black/60 transition-colors"
            >✕</button>
          </div>
          <button
            onClick={handleAnalyze}
            className="w-full py-4 rounded-2xl text-sm font-bold text-white shadow-fab active:scale-[0.98]
                       bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 transition-all"
          >
            🤖 让 Gemini 识别这张小票
          </button>
          <p className="text-center text-[11px] text-content-tertiary">识别成功后将自动填写表单</p>
        </div>
      )}

      {/* analyzing 态 */}
      {ocrState === 'analyzing' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6">
          <div className="relative rounded-2xl overflow-hidden bg-gray-100 shadow-card mb-4">
            <img src={previewUrl!} alt="识别中" className="w-full max-h-48 object-contain opacity-60" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-primary-400 to-transparent
                              animate-[scanline_2s_ease-in-out_infinite] opacity-80" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-white/90 shadow-card-md
                              flex items-center justify-center text-2xl animate-pulse">🤖</div>
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-sm font-semibold text-content-primary">{ANALYZING_TEXTS[analyzingIdx]}</p>
            <div className="flex justify-center gap-1.5 pt-1">
              {ANALYZING_TEXTS.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === analyzingIdx ? 'w-4 bg-primary-500' : 'w-1.5 bg-gray-200'}`} />
              ))}
            </div>
            <p className="text-[11px] text-content-tertiary pt-1">通常 3-8 秒内完成</p>
          </div>
        </div>
      )}

      {/* error 态 */}
      {ocrState === 'error' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6 space-y-3">
          <div className="text-center py-6">
            <div className="text-4xl mb-3">😵</div>
            <p className="text-sm font-semibold text-content-primary mb-1">AI 暂时打了个盹</p>
            <p className="text-xs text-content-tertiary max-w-xs mx-auto">
              {ocrError || '识别失败，请重试'}
            </p>
          </div>
          <div className="flex gap-2">
            {previewUrl && (
              <button
                onClick={() => setOcrState('preview')}
                className="flex-1 py-3 rounded-xl border-2 border-primary-200
                           text-sm font-semibold text-primary-700 hover:bg-primary-50 transition-colors"
              >
                🔄 重新识别
              </button>
            )}
            <button
              onClick={handleReset}
              className="flex-1 py-3 rounded-xl bg-primary-600 text-white
                         text-sm font-semibold hover:bg-primary-700 transition-colors"
            >
              📸 换图
            </button>
          </div>
        </div>
      )}

      {/* done 态：父组件已切回手写 Tab，此处无需渲染 */}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 主组件：OmniInputModal
// 外层架构：
//   fixed inset-x-0 bottom-0   — 移动端全宽底部
//   sm:max-w-lg sm:mx-auto     — PC 端居中悬浮
//   max-h-[90dvh] flex flex-col — 高度限制 + 三段式 Flex 根容器
// ─────────────────────────────────────────────────────────────
export default function OmniInputModal({ isOpen, onClose, showToast }: OmniInputModalProps) {

  type InputTab = 'manual' | 'smart' | 'ocr'
  const [activeTab, setActiveTab] = useState<InputTab>('manual')

  // ── 手写表单状态 ──────────────────────────────────────────
  type TxType = 'expense' | 'income'
  const [txType,    setTxType]    = useState<TxType>('expense')
  const [amountStr, setAmountStr] = useState('')
  const [category,  setCategory]  = useState<SystemCategory>('餐饮')
  const [date,      setDate]      = useState(todayStr())
  const [note,      setNote]      = useState('')

  type SubmitState = 'idle' | 'saving' | 'success' | 'error'
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMsg,    setErrorMsg]    = useState('')

  // 收入/支出切换时重置分类
  useEffect(() => {
    setCategory(txType === 'income' ? '工资' : '餐饮')
  }, [txType])

  // 打开时重置所有状态
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

  // 金额框自动聚焦
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isOpen && activeTab === 'manual') {
      setTimeout(() => amountRef.current?.focus(), 150)
    }
  }, [isOpen, activeTab])

  const activeLedgerId = useLedgerStore(s => s.activeLedgerId)

  function validate(): string | null {
    const amt = parseFloat(amountStr)
    if (!amountStr || isNaN(amt) || amt <= 0) return '金额不能为空且必须大于 0'
    if (!date) return '请选择日期'
    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { setErrorMsg(err); return }
    setErrorMsg(''); setSubmitState('saving')
    const amt = parseFloat(amountStr)
    const data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      ledgerId: activeLedgerId, userId: 'mock-user', date,
      amount:   txType === 'income' ? amt : -amt,
      category, description: note.trim() || category,
      source: 'manual', sourceType: 'manual', status: 'cleared',
      tags: [], accountId: 'acc-manual', rawData: {}, isManuallyEdited: false,
    }
    try {
      await addTransaction(data)
      setSubmitState('success')
      setTimeout(() => onClose(), 600)
    } catch (e) {
      setErrorMsg((e instanceof Error ? e.message : String(e)).slice(0, 120))
      setSubmitState('error')
    }
  }

  // OCR 识别结果回填手写 Tab
  function handleOcrFill(amount: number, cat: SystemCategory, d: string, notes: string) {
    setAmountStr(String(Math.abs(amount)))
    setCategory(cat); setDate(d); setNote(notes)
    setTxType('expense'); setSubmitState('idle'); setErrorMsg('')
    setActiveTab('manual')
  }

  if (!isOpen) return null

  const categories = txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]" onClick={onClose} />

      {/* ══════════════════════════════════════════════════════
          底部抽屉 — 三段式 Flex 根容器
          移动端：全宽底部滑入
          PC 端  ：居中悬浮卡片（sm:max-w-lg sm:mx-auto sm:bottom-4）
          高度   ：max-h-[90dvh]，dvh 自动处理浏览器工具栏遮挡
          不设 overflow-y-auto — 滚动由各 Tab 内部区域独立管理
      ══════════════════════════════════════════════════════ */}
      <div className="fixed inset-x-0 bottom-0 z-50
                      sm:max-w-lg sm:mx-auto sm:bottom-4 sm:rounded-2xl
                      bg-white rounded-t-2xl shadow-2xl
                      max-h-[90dvh] flex flex-col
                      animate-[slideUp_0.25s_ease-out]">

        {/* ══ ① Header：把手 + 标题行 + Tab 切换栏（固定不滚动）══ */}
        <div className="flex-shrink-0">

          {/* 把手 */}
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

          {/* 三 Tab 切换栏 */}
          <div className="flex gap-2 px-5 pb-4">

            <button
              onClick={() => setActiveTab('manual')}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                activeTab === 'manual'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-surface-overlay text-content-tertiary hover:text-primary-600'
              }`}
            >
              ✍️ 手写
            </button>

            <button
              onClick={() => setActiveTab('smart')}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                activeTab === 'smart'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-surface-overlay text-content-tertiary hover:text-primary-600'
              }`}
            >
              ✨ 智能
              <span className={`ml-1 text-[9px] font-bold align-middle ${
                activeTab === 'smart' ? 'text-primary-200' : 'text-primary-400'
              }`}>✦AI</span>
            </button>

            <button
              onClick={() => setActiveTab('ocr')}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                activeTab === 'ocr'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-surface-overlay text-content-tertiary hover:text-primary-600'
              }`}
            >
              📸 拍照
              <span className={`ml-1 text-[9px] font-bold align-middle ${
                activeTab === 'ocr' ? 'text-primary-200' : 'text-primary-400'
              }`}>✦AI</span>
            </button>

          </div>
        </div>

        {/* ══ ② Body：弹性内容区，各 Tab 内部独立完成布局 ══ */}
        <div className="flex-1 min-h-0 flex flex-col">

          {/* ✍️ 手写录入 Tab
              内部也是三段式：表单字段(scroll) / 错误+保存按钮(fixed footer)
          */}
          {activeTab === 'manual' && (
            <>
              {/* 表单字段滚动区 */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-1 pb-4 space-y-4">

                {/* 收支类型 */}
                <div className="flex gap-2 p-1 bg-surface-overlay rounded-xl">
                  {([['expense','💸 支出','text-rose-600'],['income','💰 收入','text-emerald-600']] as const)
                    .map(([type, label, cls]) => (
                      <button key={type} onClick={() => setTxType(type)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                          txType === type ? `bg-white ${cls} shadow-sm` : 'text-content-tertiary'}`}>
                        {label}
                      </button>
                    ))}
                </div>

                {/* 金额 */}
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-content-tertiary">
                    {txType === 'income' ? '+¥' : '-¥'}
                  </span>
                  <input
                    ref={amountRef}
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={amountStr}
                    onChange={e => { setAmountStr(e.target.value); setErrorMsg('') }}
                    className="w-full pl-14 pr-4 py-4 text-3xl font-bold tabular-nums bg-gray-50
                               rounded-2xl border-2 border-transparent focus:border-primary-300
                               focus:bg-white outline-none transition-all text-content-primary
                               placeholder:text-gray-300"
                  />
                </div>

                {/* 分类 */}
                <div>
                  <p className="text-xs font-semibold text-content-secondary mb-2">分类</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map(cat => (
                      <button key={cat} onClick={() => setCategory(cat)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium
                                    transition-all border ${
                          category === cat
                            ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                            : 'bg-surface-overlay text-content-secondary border-transparent hover:border-gray-200'}`}>
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
                    type="date" value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-sm text-content-primary
                               border-2 border-transparent focus:border-primary-300 focus:bg-white
                               outline-none transition-all"
                  />
                </div>

                {/* 备注 */}
                <div>
                  <p className="text-xs font-semibold text-content-secondary mb-2">备注（选填）</p>
                  <input
                    type="text" placeholder={`${category}消费`} value={note} maxLength={50}
                    onChange={e => setNote(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-sm text-content-primary
                               border-2 border-transparent focus:border-primary-300 focus:bg-white
                               outline-none transition-all placeholder:text-gray-300"
                  />
                </div>

                {/* 账套提示 */}
                <div className="flex items-center gap-1.5 px-3 py-2 bg-primary-50 rounded-xl">
                  <span className="text-xs">🗂️</span>
                  <p className="text-xs text-primary-700">
                    将记入账套：<span className="font-semibold ml-1">{activeLedgerId}</span>
                  </p>
                </div>

              </div>

              {/* 底部保存区（固定悬浮，永不被表单遮挡） */}
              <div className="flex-shrink-0 px-5 pt-3 pb-6
                              bg-white border-t border-gray-100/80
                              shadow-[0_-4px_12px_rgba(0,0,0,0.04)]
                              space-y-2">
                {errorMsg && (
                  <div className="px-3 py-2 bg-red-50 rounded-xl border border-red-100">
                    <p className="text-xs text-red-600">⚠️ {errorMsg}</p>
                  </div>
                )}
                <button
                  onClick={handleSave}
                  disabled={submitState === 'saving' || submitState === 'success'}
                  className={`w-full py-4 rounded-2xl text-sm font-bold transition-all disabled:cursor-not-allowed ${
                    submitState === 'success' ? 'bg-emerald-500 text-white' :
                    submitState === 'error'   ? 'bg-red-500 text-white' :
                    'bg-primary-600 text-white hover:bg-primary-700 active:scale-[0.98] shadow-fab'}`}
                >
                  {submitState === 'saving'  ? '⏳ 正在写入云端…'        :
                   submitState === 'success' ? '✅ 已保存！看板正在更新…' :
                   submitState === 'error'   ? '❌ 保存失败，点击重试'    :
                   '💾 保存记账'}
                </button>
              </div>
            </>
          )}

          {/* ✨ 智能识别 Tab（SmartPanel 自带 flex flex-col flex-1 min-h-0） */}
          {activeTab === 'smart' && (
            <SmartPanel
              activeLedgerId={activeLedgerId}
              onClose={onClose}
              showToast={showToast}
            />
          )}

          {/* 📸 拍小票 Tab（OcrPanel 自带 flex flex-col flex-1 min-h-0） */}
          {activeTab === 'ocr' && (
            <OcrPanel
              onFillForm={handleOcrFill}
              showToast={showToast}
            />
          )}

        </div>
      </div>
    </>
  )
}
