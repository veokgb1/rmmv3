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
  type ReceiptAnalysisResult,
}                              from '@/services/aiService'
import { linkEvidenceToTransaction, subscribeEvidences, softUnbindByUrl, uploadEvidence } from '@/services/firebase/evidenceService'
import { useLedgerStore }      from '@/store/ledgerStore'
import { useAuthStore }        from '@/store/authStore'
import { useGovernanceStore }  from '@/store/governanceStore'
import { getCurrencySymbol, CURRENCY_SYMBOLS } from '@/utils/numberUtils'
import { StorageImage }        from '@/components/ui/StorageImage'
import PoolPickerModal         from '@/modals/PoolPickerModal'
import AppendAmountModal       from '@/modals/AppendAmountModal'
import type { SystemCategory } from '@/types/Category.types'
import type { Transaction }    from '@/types/Transaction.types'
import type { Evidence }       from '@/types/Evidence.types'

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
  notes:    string    // → maps to description（说明 *）
  remark:   string    // → maps to remark（备注，选填）
}

// ─────────────────────────────────────────────────────────────
// Edit mode data shape (used by HomePage to intercept save)
// ─────────────────────────────────────────────────────────────
export interface EditSaveData {
  amount:      number
  category:    string   // 放宽为 string，兼容用户自定义分类
  date:        string
  description: string
  remark:      string   // 备注（说明二）
  currency:    string
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface OmniInputModalProps {
  isOpen:      boolean
  onClose:     () => void
  showToast?:  (msg: string, type?: 'success' | 'warning' | 'error') => void
  editTx?:     Transaction
  onSaveEdit?: (data: EditSaveData) => Promise<void>
}

// ─────────────────────────────────────────────────────────────
// OCR 状态机（拍小票 Tab）
//   batch  — 多条识别结果等待用户勾选确认
// ─────────────────────────────────────────────────────────────
type OcrState = 'idle' | 'preview' | 'analyzing' | 'done' | 'error' | 'batch'

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

      {/* 卡片头：序号 + 删除 */}
      <div className="flex items-center justify-between">
        <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700
                         text-[11px] font-bold flex items-center justify-center flex-shrink-0">
          {index + 1}
        </span>
        <button
          onClick={() => onRemove(item._id)}
          className="w-7 h-7 rounded-full bg-red-50 text-red-400 flex items-center
                     justify-center text-xs hover:bg-red-100 hover:text-red-600 transition-colors"
          title="移除此条"
        >🗑️</button>
      </div>

      {/* 金额（大字醒目） */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
          -¥
        </span>
        <input
          type="number" min="0" step="0.01"
          value={item.amount}
          onChange={e => onChange(item._id, 'amount', parseFloat(e.target.value) || 0)}
          className="w-full pl-10 pr-4 py-2.5 text-xl font-bold tabular-nums
                     bg-slate-100 text-slate-900 rounded-xl border-2 border-transparent
                     focus:border-primary-300 focus:bg-white outline-none transition-all"
        />
      </div>

      {/* 分类选择器 */}
      <select
        value={item.category}
        onChange={e => onChange(item._id, 'category', e.target.value)}
        className="w-full px-3 py-2 bg-slate-100 text-slate-900 rounded-xl text-sm
                   border-2 border-transparent focus:border-primary-300 focus:bg-white
                   outline-none transition-all"
      >
        {ALL_CATEGORIES.map(cat => (
          <option key={cat} value={cat}>{CATEGORY_ICON[cat]} {cat}</option>
        ))}
      </select>

      {/* 日期 */}
      <input
        type="date"
        value={item.date}
        onChange={e => onChange(item._id, 'date', e.target.value)}
        className="w-full px-3 py-2 bg-slate-100 text-slate-900 rounded-xl text-sm
                   border-2 border-transparent focus:border-primary-300
                   focus:bg-white outline-none transition-all"
      />

      {/* 说明 *（与手工表单对齐）*/}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-1">
          说明 <span className="text-rose-400">*</span>
        </p>
        <input
          type="text"
          value={item.notes}
          placeholder="请输入说明，如「星巴克拿铁」"
          maxLength={50}
          onChange={e => onChange(item._id, 'notes', e.target.value)}
          className="w-full px-3 py-2.5 bg-slate-100 text-slate-900 rounded-xl text-sm
                     border-2 border-transparent focus:border-primary-300 focus:bg-white
                     outline-none transition-all placeholder:text-slate-400"
        />
      </div>

      {/* 备注（选填，与手工表单对齐）*/}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-1">
          备注 <span className="text-slate-400 font-normal">（选填）</span>
        </p>
        <input
          type="text"
          value={item.remark}
          placeholder="可补充额外信息，如「报销项目」"
          maxLength={100}
          onChange={e => onChange(item._id, 'remark', e.target.value)}
          className="w-full px-3 py-2.5 bg-slate-100 text-slate-900 rounded-xl text-sm
                     border-2 border-transparent focus:border-primary-300 focus:bg-white
                     outline-none transition-all placeholder:text-slate-400"
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
  // user?.uid ?? '' — 防御性写法：auth token 刷新期间 user 短暂为 null 时不崩溃
  const currentUserId = useAuthStore(s => s.user?.uid ?? '')
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
        remark:   '',
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
          userId:           currentUserId,
          date:             item.date,
          amount:           -Math.abs(item.amount),
          category:         item.category,
          description:      item.notes || item.category,
          remark:           item.remark || '',
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
              className="w-full px-4 py-3 bg-slate-100 text-slate-900 rounded-2xl text-sm
                         border-2 border-transparent focus:border-primary-300 focus:bg-white
                         outline-none transition-all resize-none leading-relaxed
                         placeholder:text-slate-400"
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
                    <span className={`ml-1 font-bold tabular-nums tracking-widest ${
                      voiceSeconds < 10 ? 'text-yellow-200' : 'text-red-100'
                    }`}>
                      {String(Math.floor(voiceSeconds / 60)).padStart(2, '0')}:{String(voiceSeconds % 60).padStart(2, '0')}
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
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-32 space-y-3">
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
  /**
   * 单条识别结果时直接填写表单
   * imageFile — 同步传递原始图片 File 对象，供主组件在手写 Tab 保存后上传凭证
   */
  onFillForm:     (amount: number, category: SystemCategory, date: string, notes: string, imageFile: File | null) => void
  /** 用于批量入账的当前账套 ID */
  activeLedgerId: string
  showToast?:     (msg: string, type?: 'success' | 'warning' | 'error') => void
}

function OcrPanel({ onFillForm, activeLedgerId, showToast }: OcrPanelProps) {
  const currentUserId = useAuthStore(s => s.user?.uid ?? '')

  const [ocrState,     setOcrState]     = useState<OcrState>('idle')
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)
  const [base64Data,   setBase64Data]   = useState('')
  const [mimeType,     setMimeType]     = useState('image/jpeg')
  const [ocrError,     setOcrError]     = useState('')
  const [analyzingIdx, setAnalyzingIdx] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 关键补丁：保存原始 File 对象（base64 只给 Gemini，File 给 uploadEvidence）──
  // base64Data 是只读快照，File 对象才有 name/type/size，uploadEvidence 需要 File
  const [imageFile, setImageFile] = useState<File | null>(null)

  // ── 批量确认态专属状态 ──────────────────────────────────────
  const [ocrBatch,      setOcrBatch]      = useState<ReceiptAnalysisResult[]>([])
  const [selectedIdxs,  setSelectedIdxs]  = useState<Set<number>>(new Set())
  const [isBatchSaving, setIsBatchSaving] = useState(false)

  useEffect(() => {
    if (ocrState !== 'analyzing') return
    const id = setInterval(() => setAnalyzingIdx(i => (i + 1) % ANALYZING_TEXTS.length), 1800)
    return () => clearInterval(id)
  }, [ocrState])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 4 * 1024 * 1024) { setOcrError('图片过大（≤4MB）'); setOcrState('error'); return }
    // ── 关键补丁：保存 File 对象引用，后续上传凭证时使用 ──────
    setImageFile(file)
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
      const results = await analyzeReceipt(base64Data, mimeType)

      if (results.length === 1) {
        // ── 单条：填入手写表单，同时传递 imageFile 给父组件 ──
        // 父组件在 handleSave 成功后会用 imageFile 调用 uploadEvidence
        const r = results[0]
        onFillForm(r.amount, r.category, r.date, r.notes, imageFile)
        setOcrState('done')
        showToast?.('✨ AI 识别成功，已自动填写表单！', 'success')
      } else {
        // ── 多条：进入批量确认视图 ──────────────────────────
        setOcrBatch(results)
        setSelectedIdxs(new Set(results.map((_, i) => i)))   // 默认全选
        setOcrState('batch')
        showToast?.(`📋 识别到 ${results.length} 条记录，请勾选确认`, 'success')
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '识别失败')
      setOcrState('error')
      showToast?.('AI 暂时打了个盹，请重试', 'warning')
    }
  }

  // ── 批量勾选切换 ────────────────────────────────────────────
  function toggleItem(i: number) {
    setSelectedIdxs(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }
  function toggleSelectAll() {
    setSelectedIdxs(prev =>
      prev.size === ocrBatch.length
        ? new Set()
        : new Set(ocrBatch.map((_, i) => i))
    )
  }

  // ── 批量入账（writeBatch 写 Firestore + 凭证绑定）──────────
  //
  // 修复前的问题：
  //   · writeBatch 写 Transaction 时完全丢弃了 imageFile（base64 只给 Gemini）
  //   · 无任何 evidences 文档写入，无 receiptUrls 更新
  //
  // 修复后的两阶段流程：
  //   阶段 1 — 预生成 docRef.id，writeBatch 批量写 Transaction（含空 receiptUrls 占位）
  //   阶段 2 — 对每个新 txId 调用 uploadEvidence(imageFile, txId, ...)
  //             ↳ uploadEvidence 内部：Storage 上传 + addDoc(evidences) + updateDoc(receiptUrls)
  //
  // 为什么对每条 Transaction 各上传一次同一张图？
  //   · evidences 集合的 transactionId 是 1:1 绑定（一张凭证 → 一张账单）
  //   · 一张收据包含多条商品行时，每条账单都需要独立的 evidence 文档
  //   · Storage 费用可忽略，但数据结构的干净性比节省几 KB 更重要
  async function handleBatchOcrSave() {
    const toSave = ocrBatch.filter((_, i) => selectedIdxs.has(i))
    if (toSave.length === 0) { showToast?.('请至少勾选一条记录', 'warning'); return }
    setIsBatchSaving(true)
    try {
      // ── 阶段 1：预生成 docRef，批量写入 Transaction ──────────
      const batch     = writeBatch(db)
      const txCol     = collection(db, 'transactions')
      const now       = serverTimestamp() as unknown as number
      const newTxIds: string[] = []

      for (const item of toSave) {
        const newRef = doc(txCol)
        newTxIds.push(newRef.id)
        batch.set(newRef, {
          ledgerId:         activeLedgerId,
          userId:           currentUserId,
          date:             item.date,
          amount:           -Math.abs(item.amount),
          category:         item.category,
          description:      item.notes || item.category,
          remark:           '',
          source:           'manual',
          sourceType:       'ocr',      // ← 正确来源标记
          status:           'cleared',
          tags:             [],
          accountId:        'acc-manual',
          rawData:          {},
          isManuallyEdited: false,
          isVerified:       false,
          receiptUrls:      [],         // 占位：uploadEvidence 会 arrayUnion 进来
          createdAt:        now,
          updatedAt:        now,
        })
      }

      await batch.commit()
      console.info('[OmniInputModal] OCR 批量账单写入成功，txIds:', newTxIds)

      // ── 阶段 2：为每条账单上传原始小票凭证 ──────────────────
      // 仅当用户通过拍照/选图选择了本地文件时执行（imageFile 不为 null）
      if (imageFile) {
        console.info('[OmniInputModal] 开始上传 OCR 凭证，共', newTxIds.length, '条账单')
        for (const txId of newTxIds) {
          try {
            await uploadEvidence(imageFile, txId, activeLedgerId, currentUserId)
            console.info('[OmniInputModal] 凭证已关联 txId:', txId)
          } catch (evErr) {
            // 凭证上传失败不阻断整体入账流程，可事后通过"补传凭证"补救
            console.error('[OmniInputModal] 凭证上传失败 txId:', txId, evErr)
          }
        }
        showToast?.(`✅ 已批量入账 ${toSave.length} 条，小票已关联`, 'success')
      } else {
        showToast?.(`✅ 已批量入账 ${toSave.length} 条记录`, 'success')
      }

      setOcrState('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '写入失败'
      setOcrError(msg)
      showToast?.('批量入账失败，请重试', 'error')
    } finally {
      setIsBatchSaving(false)
    }
  }

  function handleReset() {
    setOcrState('idle')
    setPreviewUrl(null)
    setBase64Data('')
    setImageFile(null)   // ← 同步清除 File 引用，防止重拍后仍持有旧图片
    setOcrError('')
    setOcrBatch([])
    setSelectedIdxs(new Set())
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

      {/* ── Batch 态：多条识别结果，复选框确认 ──────────────
            ① 标题栏  flex-shrink-0  固定
            ② 列表    flex-1 scroll  弹性滚动
            ③ 双按钮  flex-shrink-0  固定悬浮
      ────────────────────────────────────────────────────── */}
      {ocrState === 'batch' && (
        <>
          {/* ① 标题栏 */}
          <div className="flex-shrink-0 px-5 py-3 bg-emerald-50 border-b border-emerald-100
                          flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                📋 识别到 {ocrBatch.length} 条记录
              </p>
              <p className="text-[11px] text-emerald-600 mt-0.5">勾选要入账的条目，可取消不需要的行</p>
            </div>
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100
                             px-2.5 py-1 rounded-full tabular-nums">
              已选 {selectedIdxs.size} / {ocrBatch.length}
            </span>
          </div>

          {/* ② 可滚动列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-32 space-y-2">

            {/* 全选 / 取消全选 */}
            <button
              onClick={toggleSelectAll}
              className="text-xs font-semibold text-primary-600 hover:text-primary-800 mb-1"
            >
              {selectedIdxs.size === ocrBatch.length ? '⬜ 取消全选' : '✅ 全选'}
            </button>

            {ocrBatch.map((item, i) => {
              const selected = selectedIdxs.has(i)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleItem(i)}
                  className="w-full text-left flex items-start gap-3 p-3 rounded-2xl border-2
                             transition-colors active:scale-[0.98]"
                  style={selected
                    ? { borderColor: '#6ee7b7', background: '#f0fdf4' }
                    : { borderColor: '#e2e8f0', background: '#fff', opacity: 0.55 }
                  }
                >
                  {/* 自定义复选框 */}
                  <div
                    className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={selected
                      ? { borderColor: '#059669', background: '#059669' }
                      : { borderColor: '#cbd5e1', background: '#fff' }
                    }
                  >
                    {selected && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-base font-bold text-slate-900 tabular-nums">
                        ¥{item.amount.toFixed(2)}
                      </span>
                      <span className="text-[11px] text-slate-500">{item.date}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 truncate">
                      {CATEGORY_ICON[item.category]} {item.category}
                      {item.notes ? ` · ${item.notes}` : ''}
                    </p>
                  </div>

                  {/* 序号徽章 */}
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100
                                   text-[10px] font-bold text-slate-500
                                   flex items-center justify-center">
                    {i + 1}
                  </span>
                </button>
              )
            })}
          </div>

          {/* ③ 底部双按钮 */}
          <div className="flex-shrink-0 px-5 pt-3 pb-6 bg-white border-t border-gray-100
                          shadow-[0_-4px_16px_rgba(0,0,0,0.06)] flex gap-3">
            <button
              onClick={handleReset}
              disabled={isBatchSaving}
              className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-sm font-semibold
                         text-content-secondary hover:bg-gray-50 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🔄 重拍
            </button>
            <button
              onClick={() => void handleBatchOcrSave()}
              disabled={isBatchSaving || selectedIdxs.size === 0}
              className="flex-[2] py-3 rounded-xl text-sm font-bold text-white
                         bg-primary-600 hover:bg-primary-700 shadow-fab
                         active:scale-[0.98] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {isBatchSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>写入中…</span>
                </>
              ) : (
                <span>💾 确认入账（{selectedIdxs.size} 条）</span>
              )}
            </button>
          </div>
        </>
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
export default function OmniInputModal({ isOpen, onClose, showToast, editTx, onSaveEdit }: OmniInputModalProps) {

  type InputTab = 'manual' | 'smart' | 'ocr'
  const [activeTab, setActiveTab] = useState<InputTab>('manual')

  // ── 外部 Store（⚠️ 必须在所有 useEffect 之前声明，避免 const TDZ 问题）──
  const activeLedgerId       = useLedgerStore(s => s.activeLedgerId)
  const currentUserId        = useAuthStore(s => s.user?.uid ?? '')
  // 当前账套的货币（账套切换时自动响应），作为表单 currency 的默认值
  const activeLedgerCurrency = useLedgerStore(s =>
    s.ledgers.find(l => l.id === s.activeLedgerId)?.currency ?? 'CNY'
  )
  // 当前账套中文名称（显示用，避免暴露内部 ID）
  const activeLedgerName = useLedgerStore(s =>
    s.ledgers.find(l => l.id === s.activeLedgerId)?.name ?? s.activeLedgerId
  )

  // ── 手写表单状态 ──────────────────────────────────────────
  type TxType = 'expense' | 'income'
  const [txType,    setTxType]    = useState<TxType>('expense')
  const [amountStr, setAmountStr] = useState('')
  // category 放宽为 string，兼容用户新增的自定义分类
  const [category,  setCategory]  = useState<string>('餐饮')
  const [date,      setDate]      = useState(todayStr())
  const [note,      setNote]      = useState('')
  const [remark,    setRemark]    = useState('')   // 备注（说明二，选填）
  // 币种：可选，默认人民币；打开弹窗时同步为当前账套货币
  const [currency,  setCurrency]  = useState<string>('CNY')

  // ── 新增分类内联输入状态 ──────────────────────────────────
  const [showCatInput,   setShowCatInput]   = useState(false)
  const [customCatInput, setCustomCatInput] = useState('')

  // ── 凭证池关联状态 ────────────────────────────────────────
  const [showPoolPicker,     setShowPoolPicker]     = useState(false)
  const [pendingPoolEvidence,setPendingPoolEvidence] = useState<Evidence | null>(null)  // 已选但待确认
  const [isLinking,          setIsLinking]          = useState(false)  // 关联请求中

  // ── OCR 单条路径：暂存从拍照 Tab 传来的原始图片 File ─────
  // 用于在手写 Tab 保存后（addTransaction 返回 txId），上传凭证并关联
  const [ocrImageFile, setOcrImageFile] = useState<File | null>(null)

  // ── 本地凭证 URL 列表（路径 A 同步修复）─────────────────────
  // editTx.receiptUrls 是来自 Firestore 的 prop，关联操作后不会自动更新。
  // 维护本地 localReceiptUrls：初始化为 editTx.receiptUrls，关联成功后本地追加。
  // 展示时合并两个来源，确保新关联的图片立即可见且 💔 按钮有效。
  const [localReceiptUrls, setLocalReceiptUrls] = useState<string[]>([])

  // ── 解绑入口：storageUrl → evidenceId 映射（编辑模式专用）──
  // 订阅当前编辑账单的 evidences，建立 url→id 映射，供缩略图解绑按钮使用
  const [urlToEvId, setUrlToEvId] = useState<Record<string, string>>({})
  const openUnbindModal = useGovernanceStore(s => s.openUnbindModal)

  useEffect(() => {
    if (!editTx?.id) { setUrlToEvId({}); return }
    const unsub = subscribeEvidences(editTx.id, (evs) => {
      const map: Record<string, string> = {}
      evs.forEach(ev => { if (ev.status === 'ok') map[ev.storageUrl] = ev.id })
      setUrlToEvId(map)
    })
    return unsub
  }, [editTx?.id])

  type SubmitState = 'idle' | 'saving' | 'success' | 'error'
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMsg,    setErrorMsg]    = useState('')

  // ── OCR 回填标志（防止 txType effect 在 OCR 填表后覆盖 AI 识别的分类）──
  const ocrFillingRef = useRef(false)
  // ── 编辑模式收支互转标志（防止 txType effect 重置手动搬运的分类）──
  const editTypeSwappingRef = useRef(false)

  // 收入/支出切换时重置分类
  // 例外1：OCR 刚刚回填时（ocrFillingRef=true），跳过重置
  // 例外2：编辑模式收支互转确认后（editTypeSwappingRef=true），分类已手动设定，跳过重置
  useEffect(() => {
    if (ocrFillingRef.current)      { ocrFillingRef.current = false; return }
    if (editTypeSwappingRef.current){ editTypeSwappingRef.current = false; return }
    setCategory(txType === 'income' ? '工资' : '餐饮')
  }, [txType])

  // ── activeLedgerCurrency 的 ref 镜像 ──────────────────────────
  // 通过 ref 读取最新货币值，避免将其加入 useEffect 依赖数组，
  // 防止 Firestore ledger 快照导致的 OCR 期间表单被清空（Bug A-2 修复）
  const activeLedgerCurrencyRef = useRef(activeLedgerCurrency)
  activeLedgerCurrencyRef.current = activeLedgerCurrency

  // ── 追踪 isOpen 跳变（false→true）──────────────────────────
  // 确保只在 Modal 首次打开时重置表单，
  // 而非每次 activeLedgerCurrency 变化时都重置（导致 OCR 结果被清空）
  const prevIsOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setActiveTab('manual')
      setSubmitState('idle')
      setErrorMsg('')
      setShowCatInput(false)
      setCustomCatInput('')
      setLocalReceiptUrls([])  // 重置本地追加列表（新开弹窗时清空）
      setOcrImageFile(null)    // 重置 OCR 图片引用（防止跨次复用）
      if (editTx) {
        setTxType(editTx.amount > 0 ? 'income' : 'expense')
        setAmountStr(String(Math.abs(editTx.amount)))
        setCategory(editTx.category)
        setDate(editTx.date)
        setNote(editTx.description || '')
        setRemark(editTx.remark ?? '')
        setCurrency(activeLedgerCurrencyRef.current)
      } else {
        setTxType('expense')
        setAmountStr('')
        setCategory('餐饮')
        setDate(todayStr())
        setNote('')
        setRemark('')
        setCurrency(activeLedgerCurrencyRef.current)
      }
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, editTx])

  // 金额框自动聚焦
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isOpen && activeTab === 'manual') {
      setTimeout(() => amountRef.current?.focus(), 150)
    }
  }, [isOpen, activeTab])

  // ── 收支类型切换（编辑模式需弹确认，普通模式直接切）────────
  function handleTypeToggle(newType: TxType) {
    if (newType === txType) return  // 未切换，无需处理

    if (editTx) {
      // 编辑模式：弹原生确认框，防止误操作
      const label = newType === 'income' ? '收入' : '支出'
      const ok = window.confirm(
        `确定将此笔账单切换为【${label}】吗？\n\n` +
        `✅ 保留：金额绝对值、说明、备注、日期\n` +
        `🔄 重置：分类将重置为默认${label}分类\n\n` +
        `切换后请检查所有字段，然后手动点击「保存修改」。`
      )
      if (!ok) return

      // 标记：阻止 txType useEffect 重置分类（我们手动搬运）
      editTypeSwappingRef.current = true
      setTxType(newType)
      setCategory(newType === 'income' ? '工资' : '餐饮')
      // amountStr / note / remark / date 保持原值，无需操作
      setShowCatInput(false)
      setCustomCatInput('')
      setErrorMsg('')
    } else {
      // 新建模式：直接切换，useEffect 自动重置分类
      setTxType(newType)
    }
  }

  // ── 确认新增自定义分类 ────────────────────────────────────
  function confirmCustomCat() {
    const name = customCatInput.trim()
    if (!name) return
    setCategory(name)
    setShowCatInput(false)
    setCustomCatInput('')
  }

  // ── 凭证池：用户选中一张凭证 ──────────────────────────────
  function handlePoolSelect(ev: Evidence): void {
    setShowPoolPicker(false)
    const hasExistingReceipts = (editTx?.receiptUrls?.length ?? 0) >= 1
    if (hasExistingReceipts) {
      // 已有凭证 → 弹出金额合并确认
      setPendingPoolEvidence(ev)
    } else {
      // 无现有凭证 → 直接关联
      void handlePoolLinkConfirm(ev, null)
    }
  }

  // ── 凭证池：AppendAmountModal 确认后执行关联 ───────────────
  async function handlePoolLinkConfirm(
    ev: Evidence,
    newAmount: number | null,
  ): Promise<void> {
    if (!editTx) return
    setPendingPoolEvidence(null)
    setIsLinking(true)
    setErrorMsg('')
    try {
      const { storageUrl } = await linkEvidenceToTransaction(ev.id, editTx.id)

      // 路径 A 同步：关联成功后本地立即追加 URL，使缩略图与 💔 按钮立即可用
      // （editTx.receiptUrls 是 prop 不自动更新，urlToEvId 由 subscribeEvidences 自动更新）
      setLocalReceiptUrls(prev =>
        prev.includes(storageUrl) ? prev : [...prev, storageUrl]
      )

      // 若用户选择了合并金额，更新表单金额字段（实际保存时通过 onSaveEdit 写入）
      if (newAmount !== null) {
        setAmountStr(String(Math.abs(newAmount)))
        setTxType(newAmount > 0 ? 'income' : 'expense')
        showToast?.(`✅ 凭证已关联，金额已合并为 ¥${String(Math.abs(newAmount))}`, 'success')
      } else {
        showToast?.('✅ 凭证已关联至账单', 'success')
      }
    } catch (e) {
      showToast?.('❌ 凭证关联失败，请重试', 'error')
      setErrorMsg(e instanceof Error ? e.message : '凭证关联失败，请重试')
    } finally {
      setIsLinking(false)
    }
  }

  // ── V2 历史数据直接软解绑（无 evidenceId）─────────────────
  async function handleV2SoftUnbind(url: string): Promise<void> {
    if (!editTx) return
    const ok = window.confirm(
      '确认解绑此凭证？\n凭证将保留至凭证池（Pool B），可在治理中心找回。'
    )
    if (!ok) return
    setIsLinking(true)
    setErrorMsg('')
    try {
      await softUnbindByUrl(editTx.id, url, {
        date:     editTx.date,
        category: editTx.category,
        amount:   editTx.amount,
        ledgerId: activeLedgerId,
      })
      showToast?.('💔 凭证已解绑并移入凭证池', 'success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '解绑失败，请重试')
    } finally {
      setIsLinking(false)
    }
  }

  function validate(): string | null {
    const amt = parseFloat(amountStr)
    if (!amountStr || isNaN(amt) || amt <= 0) return '金额不能为空且必须大于 0'
    if (!date) return '请选择日期'
    if (!note.trim()) return '请填写说明（如：星巴克拿铁）'
    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { setErrorMsg(err); return }
    setErrorMsg(''); setSubmitState('saving')
    const amt = parseFloat(amountStr)

    if (editTx && onSaveEdit) {
      try {
        await onSaveEdit({
          amount:      txType === 'income' ? amt : -amt,
          category,
          date,
          description: note.trim() || category,
          remark:      remark.trim(),
          currency,
        })
        setSubmitState('success')
        onClose()
      } catch (e) {
        const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 120)
        setErrorMsg(errMsg)
        setSubmitState('error')
      }
      return
    }

    // sourceType：若来自 OCR 识别（ocrImageFile 存在），标记为 'ocr'；否则 'manual'
    const sourceType = ocrImageFile ? 'ocr' : 'manual'
    const data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      ledgerId: activeLedgerId, userId: currentUserId, date,
      amount:   txType === 'income' ? amt : -amt,
      category, description: note.trim() || category,
      remark:   remark.trim(),   // 绝不写 undefined，空字符串合法
      source: 'manual', sourceType, status: 'cleared',
      tags: [], accountId: 'acc-manual', rawData: {}, isManuallyEdited: false,
      isVerified: false,
      receiptUrls: [],           // 占位：uploadEvidence 会 arrayUnion 进来
    }
    try {
      // addTransaction 返回新生成的 Firestore 文档 ID
      const newTxId = await addTransaction(data)
      console.info('[OmniInputModal] 账单已写入 txId:', newTxId)

      // ── 关键补丁：OCR 单条路径 — 保存成功后上传小票凭证 ──
      // ocrImageFile 由 handleOcrFill 从 OcrPanel 传递而来
      // 在 addTransaction 成功（txId 已确定）后才执行上传，确保绑定关系准确
      if (ocrImageFile && newTxId) {
        try {
          await uploadEvidence(ocrImageFile, newTxId, activeLedgerId, currentUserId)
          console.info('[OmniInputModal] OCR 凭证已关联 txId:', newTxId)
          setOcrImageFile(null)  // 上传成功后清除引用
        } catch (evErr) {
          // 凭证上传失败不阻断入账结果，用户可通过"补传凭证"补救
          console.error('[OmniInputModal] OCR 凭证上传失败（账单已入账）:', evErr)
        }
      }

      showToast?.('✅ 入账成功！账单正在更新…', 'success')
      setSubmitState('success')
      setTimeout(() => onClose(), 800)
    } catch (e) {
      const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 120)
      console.error('[OmniInputModal] addTransaction 失败:', errMsg)
      setErrorMsg(errMsg)
      setSubmitState('error')
    }
  }

  // OCR 识别结果回填手写 Tab
  // 在设置 txType 之前先标记 ocrFillingRef，防止 txType effect 覆盖 AI 分类
  // imageFile — 同步接收来自 OcrPanel 的原始图片 File，handleSave 保存后上传凭证
  function handleOcrFill(amount: number, cat: SystemCategory, d: string, notes: string, imageFile: File | null) {
    ocrFillingRef.current = true
    setAmountStr(String(Math.abs(amount)))
    setCategory(cat); setDate(d); setNote(notes)
    setTxType('expense'); setSubmitState('idle'); setErrorMsg('')
    setOcrImageFile(imageFile)   // ← 暂存图片，handleSave 成功后上传
    setActiveTab('manual')
  }

  if (!isOpen) return null

  const categories = txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  return (
    // ══════════════════════════════════════════════════════
    // 统一遮罩容器（Bug A-1 修复）：
    //   · z-[500] 确保高于所有 S21 全局浮层（EvidenceUploader z-300 / Unbinding z-400）
    //   · 单容器架构消除两个兄弟 fixed div 之间的 pointer-events 事件捕获歧义
    //   · 点击外层（遮罩） → onClose；点击内层 Modal → stopPropagation 阻断
    // ══════════════════════════════════════════════════════
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      onClick={onClose}
    >
      {/* 遮罩背景（absolute，处于 Modal 本体之下）*/}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* Modal 本体 — 三段式 Flex 根容器
          · relative：确保在 absolute 遮罩层之上，事件不再穿透到遮罩
          · 宽度  ：w-[95%] sm:max-w-lg，三 Tab 切换宽度绝对稳定
          · 高度  ：max-h-[90dvh]，内容自动撑开，极限截断 dvh
          · 圆角  ：rounded-2xl（全局圆角，非贴底半圆）
          · 内部不设 overflow-y-auto — 滚动由各 Tab Body 区独立管理
      */}
      <div
        className={`relative w-[95%] sm:max-w-lg
                   ${activeTab === 'manual' && txType === 'income' ? 'bg-blue-50' : 'bg-white'}
                   rounded-2xl shadow-xl
                   max-h-[90dvh] flex flex-col overflow-hidden
                   animate-[slideUp_0.25s_ease-out]`}
        onClick={e => e.stopPropagation()}
      >

        {/* ══ ① Header：标题行 + Tab 切换栏（固定不滚动）══ */}
        <div className="flex-shrink-0 pt-4">

          <div className="flex items-center justify-between px-5 pb-3">
            <div>
              <h2 className="text-base font-bold text-content-primary">
                {editTx ? '修改记录' : '记一笔'}
              </h2>
              {editTx && (
                <p className="text-[11px] text-red-500 font-medium mt-0.5">当前处于修改模式</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full
                         bg-surface-overlay text-content-tertiary hover:bg-gray-200"
            >
              ✕
            </button>
          </div>

          {!editTx && (
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
          )}
        </div>

        {/* ══ ② Body：弹性内容区，各 Tab 内部独立完成布局 ══ */}
        <div className="flex-1 min-h-0 flex flex-col">

          {activeTab === 'manual' && (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-1 pb-4 space-y-3">

                <div className="flex gap-2 p-1 bg-surface-overlay rounded-xl">
                  {([['expense','💸 支出','text-rose-600'],['income','💰 收入','text-blue-600']] as const)
                    .map(([type, label, cls]) => (
                      <button key={type} onClick={() => handleTypeToggle(type)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                          txType === type ? `bg-white ${cls} shadow-sm` : 'text-content-tertiary'}`}>
                        {label}
                      </button>
                    ))}
                </div>

                <div className="flex items-stretch gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-400">
                      {txType === 'income' ? '+' : '-'}{getCurrencySymbol(currency)}
                    </span>
                    <input
                      ref={amountRef}
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amountStr}
                      onChange={e => { setAmountStr(e.target.value); setErrorMsg('') }}
                      className="w-full pl-14 pr-3 py-4 text-3xl font-bold tabular-nums
                                 bg-slate-100 text-slate-900
                                 rounded-2xl border-2 border-transparent focus:border-primary-300
                                 focus:bg-white outline-none transition-all
                                 placeholder:text-slate-300"
                    />
                  </div>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="flex-shrink-0 px-2 bg-slate-100 text-slate-700 text-xs font-semibold
                               rounded-2xl border-2 border-transparent focus:border-primary-300
                               focus:bg-white outline-none transition-all cursor-pointer"
                  >
                    {Object.keys(CURRENCY_SYMBOLS).map(code => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">说明 <span className="text-rose-400">*</span></p>
                  <input
                    type="text"
                    placeholder="请输入说明，如「星巴克拿铁」"
                    value={note}
                    maxLength={50}
                    onChange={e => setNote(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-100 text-slate-900 rounded-xl text-sm
                               border-2 border-transparent focus:border-primary-300 focus:bg-white
                               outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">备注 <span className="text-slate-400 font-normal">（选填）</span></p>
                  <input
                    type="text"
                    placeholder="可补充额外信息，如「报销项目 / 请客原因」"
                    value={remark}
                    maxLength={100}
                    onChange={e => setRemark(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-100 text-slate-900 rounded-xl text-sm
                               border-2 border-transparent focus:border-primary-300 focus:bg-white
                               outline-none transition-all placeholder:text-slate-400"
                  />
                </div>

                {/* ── 凭证管理区（仅编辑模式显示）────────────── */}
                {editTx && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-slate-600">
                        凭证图片
                        {(editTx.receiptUrls?.length ?? 0) > 0 && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-200
                                           text-slate-500 text-[9px] font-bold">
                            {editTx.receiptUrls!.length} 张
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowPoolPicker(true)}
                        disabled={isLinking}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold
                                   bg-teal-50 text-teal-700 border border-teal-200
                                   hover:bg-teal-100 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLinking ? (
                          <><span className="w-3 h-3 border-2 border-teal-400/40 border-t-teal-600 rounded-full animate-spin" /><span>关联中…</span></>
                        ) : (
                          <><span>🗄️</span><span>从凭证池关联</span></>
                        )}
                      </button>
                    </div>

                    {/* ── 凭证缩略图列表 ──────────────────────────────────
                        合并：editTx.receiptUrls ∪ localReceiptUrls（去重）
                        localReceiptUrls 路径 A 关联后即时追加，无需等待 prop 更新  */}
                    {((): string[] => {
                      const base = editTx.receiptUrls ?? []
                      return [...base, ...localReceiptUrls.filter(u => !base.includes(u))]
                    })().length > 0 ? (() => {
                      const base   = editTx.receiptUrls ?? []
                      const merged = [...base, ...localReceiptUrls.filter(u => !base.includes(u))]
                      return (
                        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                          {merged.map((url, i) => {
                            const evId = urlToEvId[url]
                            return (
                              <div
                                key={url}
                                className="relative flex-shrink-0 rounded-xl overflow-hidden"
                                style={{ width: 56, height: 56 }}
                              >
                                {/* 缩略图 */}
                                <StorageImage
                                  path={url}
                                  alt={`凭证 ${i + 1}`}
                                  className="w-full h-full object-cover"
                                />

                                {/* ── 解绑药丸标签（底部覆盖条）──
                                    · 定位底部全宽，不遮挡图片中央内容
                                    · inline style 保证颜色不被 PurgeCSS 剔除
                                    · hover:scale-105 提升可点击感知
                                    · evId 有无决定走哪条解绑路径               */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (evId) {
                                      openUnbindModal({
                                        evidenceId:    evId,
                                        transactionId: editTx.id,
                                        evidenceUrl:   url,
                                        onSuccess: (action) => {
                                          showToast?.(
                                            action === 'unbound'
                                              ? '✅ 凭证已解绑并移入凭证池'
                                              : '🗑️ 凭证已彻底删除',
                                            'success',
                                          )
                                        },
                                      })
                                    } else {
                                      void handleV2SoftUnbind(url)
                                    }
                                  }}
                                  className="absolute bottom-0 inset-x-0 z-10
                                             flex items-center justify-center gap-0.5
                                             py-0.5 text-white font-bold
                                             transition-transform hover:scale-105 active:scale-95"
                                  style={{
                                    background: 'rgba(245,158,11,0.88)',
                                    fontSize: 9,
                                    lineHeight: '14px',
                                  }}
                                  title={evId
                                    ? '解绑此凭证（保留至凭证池）'
                                    : '解绑 V2 历史凭证（保留至凭证池）'
                                  }
                                >
                                  {/* Unlink SVG icon */}
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                                       stroke="currentColor" strokeWidth="2.5"
                                       strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                    <line x1="5" y1="5" x2="19" y2="19"/>
                                  </svg>
                                  <span>解绑</span>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })() : (
                      <div className="flex items-center justify-center h-12
                                      bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                        <p className="text-xs text-slate-400">暂无凭证，可从凭证池关联</p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-content-secondary mb-1.5">分类</p>
                  <div className="flex flex-wrap gap-1.5">
                    {/* 系统分类芯片 */}
                    {categories.map(cat => (
                      <button key={cat} onClick={() => { setCategory(cat); setShowCatInput(false) }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium
                                    transition-all border ${
                          category === cat
                            ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                            : 'bg-surface-overlay text-content-secondary border-transparent hover:border-gray-200'}`}>
                        <span>{CATEGORY_ICON[cat] ?? '📋'}</span>
                        <span>{cat}</span>
                      </button>
                    ))}

                    {/* 用户已输入的自定义分类芯片（不在系统列表中时才显示）*/}
                    {category && !(categories as readonly string[]).includes(category) && (
                      <button
                        onClick={() => setCategory(category)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium
                                   transition-all border bg-primary-600 text-white border-primary-600 shadow-sm"
                      >
                        <span>📌</span>
                        <span>{category}</span>
                      </button>
                    )}

                    {/* ➕ 新增分类按钮 */}
                    {!showCatInput && (
                      <button
                        onClick={() => { setShowCatInput(true); setCustomCatInput('') }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium
                                   transition-all border border-dashed border-slate-300
                                   text-slate-500 hover:border-primary-400 hover:text-primary-600"
                      >
                        <span>➕</span>
                        <span>新增</span>
                      </button>
                    )}
                  </div>

                  {/* 内联新增分类输入区 */}
                  {showCatInput && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text"
                        autoFocus
                        value={customCatInput}
                        onChange={e => setCustomCatInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  confirmCustomCat()
                          if (e.key === 'Escape') { setShowCatInput(false); setCustomCatInput('') }
                        }}
                        placeholder="输入分类名，如「人情往来」"
                        maxLength={20}
                        className="flex-1 px-3 py-1.5 bg-slate-100 text-slate-900 rounded-xl text-xs
                                   border-2 border-primary-300 focus:border-primary-500
                                   outline-none transition-all placeholder:text-slate-400"
                      />
                      <button
                        onClick={confirmCustomCat}
                        disabled={!customCatInput.trim()}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary-600 text-white
                                   hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed
                                   transition-colors"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => { setShowCatInput(false); setCustomCatInput('') }}
                        className="px-2 py-1.5 rounded-xl text-xs text-slate-500
                                   hover:bg-slate-100 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">日期</p>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-100 text-slate-900 rounded-xl text-sm
                               border-2 border-transparent focus:border-primary-300 focus:bg-white
                               outline-none transition-all"
                  />
                </div>

                {!editTx && (
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-primary-50 rounded-xl">
                    <span className="text-xs">🗂️</span>
                    <p className="text-xs text-primary-700">
                      将记入账套：<span className="font-semibold ml-1">{activeLedgerName}</span>
                    </p>
                  </div>
                )}

              </div>

              <div className={`flex-shrink-0 px-5 pt-3 pb-6 border-t border-gray-100/80
                              shadow-[0_-4px_12px_rgba(0,0,0,0.04)] space-y-2
                              ${txType === 'income' ? 'bg-blue-50' : 'bg-white'}`}>
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
                  {submitState === 'saving' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      {editTx ? '正在保存…' : '正在入账…'}
                    </span>
                  ) : submitState === 'success' ? (editTx ? '✅ 修改成功！' : '✅ 入账成功！')
                    : submitState === 'error'   ? '❌ 失败，点击重试'
                    : (editTx ? '💾 保存修改' : '💾 保存记账')}
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
              activeLedgerId={activeLedgerId}
              showToast={showToast}
            />
          )}

        </div>
      </div>{/* Modal 本体结束 */}

      {/* ═══ 凭证池选择器（z-[630]，在 Modal z-[500] 之上）═══ */}
      {showPoolPicker && editTx && (
        <PoolPickerModal
          ledgerId={activeLedgerId}
          onSelect={handlePoolSelect}
          onClose={() => setShowPoolPicker(false)}
        />
      )}

      {/* ═══ 金额合并确认（z-[620]，等待 AppendAmountModal 结果）═══ */}
      {pendingPoolEvidence && editTx && (
        <AppendAmountModal
          originalAmount={editTx.amount}
          evidenceUrl={pendingPoolEvidence.storageUrl}
          onConfirm={({ newAmount }) => {
            void handlePoolLinkConfirm(pendingPoolEvidence, newAmount)
          }}
          onCancel={() => setPendingPoolEvidence(null)}
        />
      )}

    </div>
  )
}
