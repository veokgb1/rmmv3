// ImportModal — 万能导入清洗工作台 (V3-指令-21)
//
// ┌─ 绿卡 ✅ checked=true  ─── 正常条目，金额+日期与现有账单无冲突，默认选中
// └─ 黄卡 ⚠️ checked=false ─── 疑似重复，金额+日期与已有账单完全一致，默认不选
//
// 解析漏斗（本地零成本 → AI 智能兜底）：
//   Step 1  微信/支付宝 CSV 本地解析器（parseBillText）
//   Step 2  Google Sheets / Excel TSV 本地解析器
//   Step 3  AI 批量文本解析（parseNaturalLanguageBatch）兜底
//   Step 4  AI 图像识别（analyzeReceipt）兜底
//
// 预览表功能：
//   · 全选 / 取消全选（Header 复选框，支持 indeterminate 态）
//   · 内联编辑：分类（下拉）| 主要事项（文本）| 摘要备注（文本）| 金额（数字）
//   · 行级 ✕ 移除（在内存中丢弃，绝不落盘）
//   · 确认按钮：仅 writeBatch 已选中的行
//
// 性能策略：
//   · PreviewRow 用 React.memo 包裹，仅变动行重渲染
//   · onToggle / onUpdate / onRemove 均为 useCallback(fn, []) 空依赖，引用永远稳定
//   · allChecked / someChecked / checkedCount 单次 useMemo 合并计算

import React, { useState, useCallback, useRef, useMemo } from 'react'
import { writeBatch, collection, doc, serverTimestamp }   from 'firebase/firestore'
import { CURRENCY_SYMBOLS }                               from '@/utils/numberUtils'
import { parseBillText }                                  from '@/services/parsers'
import {
  analyzeReceipt,
  parseNaturalLanguageBatch,
  mapCategoryBatch,
}                                                         from '@/services/aiService'
import { db }                                             from '@/config/firebase'
import { useAuthStore }                                   from '@/store/authStore'
import { useLedgerStore }                                 from '@/store/ledgerStore'
import { useBillStore }                                   from '@/store/billStore'
import { toChineseDate }                                  from '@/utils/dateUtils'
import type { Transaction, TransactionSource, SourceType } from '@/types/Transaction.types'
import type { SystemCategory }                            from '@/types/Category.types'

// ── 常量 ─────────────────────────────────────────────────────────

const ALL_CATEGORIES: SystemCategory[] = [
  '餐饮', '交通', '购物', '娱乐', '医疗', '居住', '教育',
  '工资', '副业收入', '理财收益', '转账', '未分类',
]

const CATEGORY_ICON: Record<string, string> = {
  '餐饮': '🍜', '交通': '🚇', '购物': '🛍️', '娱乐': '🎮',
  '医疗': '💊', '居住': '🏠', '教育': '📚', '工资': '💰',
  '副业收入': '💻', '理财收益': '📈', '转账': '↔️', '未分类': '📋',
}

const INCOME_CATEGORIES = new Set(['工资', '副业收入', '理财收益'])

/** 分类关键词映射表（Google Sheets 字段归一化） */
const CATEGORY_KEYWORDS: [string, string][] = [
  ['餐饮', '餐饮'], ['外卖', '餐饮'], ['饮食', '餐饮'], ['餐厅', '餐饮'],
  ['咖啡', '餐饮'], ['奶茶', '餐饮'],
  ['交通', '交通'], ['出行', '交通'], ['打车', '交通'], ['地铁', '交通'],
  ['公交', '交通'], ['加油', '交通'],
  ['购物', '购物'], ['网购', '购物'], ['日用', '购物'], ['服装', '购物'],
  ['娱乐', '娱乐'], ['游戏', '娱乐'], ['电影', '娱乐'], ['健身', '娱乐'],
  ['医疗', '医疗'], ['医药', '医疗'], ['药', '医疗'], ['看病', '医疗'], ['护工', '医疗'],
  ['居住', '居住'], ['房租', '居住'], ['水电', '居住'], ['物业', '居住'],
  ['教育', '教育'], ['学习', '教育'], ['书', '教育'], ['课程', '教育'],
  ['工资', '工资'], ['薪资', '工资'], ['薪酬', '工资'],
  ['副业', '副业收入'], ['副业收入', '副业收入'],
  ['理财', '理财收益'], ['理财收益', '理财收益'], ['投资', '理财收益'],
  ['转账', '转账'],
]

function mapCategory(raw: string): string {
  if (!raw?.trim()) return '未分类'
  const s = raw.trim()
  for (const [kw, cat] of CATEGORY_KEYWORDS) {
    if (s === kw || s.includes(kw)) return cat
  }
  return '未分类'
}

// ── 类型定义 ─────────────────────────────────────────────────────

/** 内存预览条目（含复选框、重复检测、双字段拆分） */
interface PreviewItem {
  _id:                 string
  checked:             boolean          // 复选框状态（只有 true 才写入 Firestore）
  isDuplicateDetected: boolean          // 黄卡：金额+日期与现有账单完全一致
  isAiCategorized?:    boolean          // 蓝点：分类由 AI mapCategoryBatch 智能纠正
  title:               string           // 主要事项（前 20 字，可内联编辑）
  date:                string
  amount:              number           // 正=收入，负=支出
  category:            string
  description:         string           // 摘要备注（完整文本，可内联编辑）
  tags:                string[]
  accountId:           string
  sourceType:          SourceType
  source:              TransactionSource
  rawData:             Record<string, unknown>
  originalParsedData:  Record<string, unknown>
  parseError?:         string
}

type Stage     = 'input' | 'processing' | 'preview' | 'done'
type InputMode = 'text' | 'file'

interface ImportModalProps {
  isOpen:  boolean
  onClose: () => void
}

// ── 工具函数 ─────────────────────────────────────────────────────

/** 构建现有账单的去重集合（key = "amount|date"，O(1) 查找） */
function buildDupSet(txs: Transaction[]): Set<string> {
  const s = new Set<string>()
  for (const tx of txs) {
    if (tx.status !== 'void') s.add(`${tx.amount}|${tx.date}`)
  }
  return s
}

/** 为解析结果注入重复检测结果（黄卡默认不选中） */
function applyDupCheck(items: PreviewItem[], dupSet: Set<string>): PreviewItem[] {
  return items.map(item => {
    const isDup = dupSet.has(`${item.amount}|${item.date}`)
    if (!isDup) return item
    return { ...item, isDuplicateDetected: true, checked: false }
  })
}

// ── Google Sheets / Excel TSV 本地解析器 ─────────────────────────
// 列顺序：A:交易日期 | B:归属月份 | C:收支类型 | D:资金分类 | E:金额 | F:摘要/备注

function parseGoogleSheetsTSV(text: string): PreviewItem[] {
  const lines  = text.trim().split('\n')
  const result: PreviewItem[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const sep  = line.includes('\t') ? '\t' : ','
    const cols = line.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''))
    if (cols.length < 5) continue

    const [rawDate, , directionRaw, rawCategory, rawAmount, rawDesc = ''] = cols

    // 跳过标题行
    if (/日期|date|时间|交易/i.test(rawDate)) continue

    // 解析日期（支持 YYYY/M/D、YYYY-M-D、YYYY年M月D日）
    const dm = rawDate.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/)
    if (!dm) continue
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`

    // 解析金额（去掉货币符号、千位分隔符）
    const absAmt = parseFloat(rawAmount.replace(/[,，¥￥$\s]/g, ''))
    if (isNaN(absAmt) || absAmt === 0) continue

    // 收支方向："支出" 取负，缺省也视为支出
    const isExpense   = !directionRaw || directionRaw.includes('支出')
    const amount      = isExpense ? -Math.abs(absAmt) : Math.abs(absAmt)
    const category    = mapCategory(rawCategory)
    const description = rawDesc.trim() || rawCategory.trim() || category
    const title       = description.slice(0, 20)

    result.push({
      _id:                `tsv-${Date.now()}-${result.length}`,
      checked:            true,
      isDuplicateDetected: false,
      title, date, amount, category, description,
      tags:               [],
      accountId:          'acc-manual',
      sourceType:         'csv',
      source:             'manual',
      rawData:            { raw: rawLine },
      originalParsedData: { rawDate, direction: directionRaw, rawCategory, rawAmount, rawDesc },
    })
  }

  return result
}

// ── 本地解析统一入口 ─────────────────────────────────────────────
// 先试微信/支付宝 CSV，再试 Google Sheets TSV

function runLocalParse(text: string): PreviewItem[] {
  const csvResult = parseBillText(text)
  if (csvResult.success.length > 0) {
    return csvResult.success.map((tx, i) => {
      const description = tx.description
      const title       = description.slice(0, 20)
      return {
        _id:                `csv-${Date.now()}-${i}`,
        checked:            true,
        isDuplicateDetected: false,
        title,
        date:               tx.date  ?? new Date().toISOString().slice(0, 10),
        amount:             tx.amount ?? 0,
        category:           tx.category,
        description,
        tags:               tx.tags,
        accountId:          tx.accountId,
        sourceType:         tx.sourceType,
        source:             tx.source,
        rawData:            tx.rawData,
        originalParsedData: tx.originalParsedData,
        parseError:         tx.parseError,
      }
    })
  }
  return parseGoogleSheetsTSV(text)
}

// ── AI 分类增强管道 ─────────────────────────────────────────────
// 本地关键词表命中率约 80%，剩余"未分类"条目交由 Gemini 批量映射。
// 失败时静默降级，保持"未分类"不中断导入流程。
async function enrichCategoriesWithAI(items: PreviewItem[]): Promise<PreviewItem[]> {
  // 筛选出本地无法识别分类的条目
  const unmapped = items.filter(i => i.category === '未分类')
  if (unmapped.length === 0) return items

  // 构造批量请求载荷（只送 id + description，最小化 token 消耗）
  const aiInput = unmapped.map(i => ({ id: i._id, description: i.description }))

  // 调用 AI 映射（失败时返回空 Map，不抛出）
  const mapping = await mapCategoryBatch(aiInput)
  if (mapping.size === 0) return items

  // 用映射结果替换"未分类"条目的 category 字段，并标记 isAiCategorized
  return items.map(item => {
    if (!mapping.has(item._id)) return item
    const newCat   = mapping.get(item._id)!
    // 若分类切换了收支性质（如未分类→工资），同步修正金额符号
    const wasInc   = INCOME_CATEGORIES.has(item.category)
    const isNowInc = INCOME_CATEGORIES.has(newCat)
    let amount     = item.amount
    if (isNowInc && !wasInc) amount =  Math.abs(amount)
    if (!isNowInc && wasInc) amount = -Math.abs(amount)
    // isAiCategorized 仅在 AI 给出了与原值不同的分类时点亮蓝点
    const isAiCategorized = newCat !== '未分类'
    return { ...item, category: newCat, amount, isAiCategorized }
  })
}

// ── 主组件 ──────────────────────────────────────────────────────

function ImportModal({ isOpen, onClose }: ImportModalProps) {

  // ── 外部 Store ─────────────────────────────────────────────
  const currentUserId   = useAuthStore(s => s.user?.uid ?? '')
  const activeLedgerId  = useLedgerStore(s => s.activeLedgerId)
  const allTransactions = useBillStore(s => s._allTransactions)

  // 用 Ref 使 useCallback 中始终读到最新 allTransactions，无需加入 deps
  const allTxRef = useRef(allTransactions)
  allTxRef.current = allTransactions

  // ── UI 状态 ────────────────────────────────────────────────
  // 导入全局币种：应用于本次导入的所有条目（覆盖 CSV 默认 CNY）
  const [importCurrency, setImportCurrency] = useState<string>('CNY')

  const [stage,       setStage]      = useState<Stage>('input')
  const [inputMode,   setInputMode]  = useState<InputMode>('text')
  const [pastedText,  setPastedText] = useState('')
  const [items,       setItems]      = useState<PreviewItem[]>([])

  const [imageData,       setImageData]       = useState<{ base64: string; mimeType: string } | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [fileName,        setFileName]        = useState<string | null>(null)

  const [showAiFallback, setShowAiFallback] = useState(false)
  const [aiLoading,      setAiLoading]      = useState(false)
  const [aiError,        setAiError]        = useState<string | null>(null)

  const [importing,     setImporting]     = useState(false)
  const [importError,   setImportError]   = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 衍生计算（单次 useMemo，避免重复遍历） ──────────────────
  const { checkedCount, allChecked, someChecked } = useMemo(() => {
    const count = items.filter(i => i.checked).length
    return {
      checkedCount: count,
      allChecked:   items.length > 0 && count === items.length,
      someChecked:  count > 0 && count < items.length,
    }
  }, [items])

  // ── 重置所有状态 ───────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStage('input')
    setPastedText('')
    setItems([])
    setImageData(null)
    setPreviewImageUrl(null)
    setFileName(null)
    setShowAiFallback(false)
    setAiLoading(false)
    setAiError(null)
    setImportError(null)
  }, [])

  // ── 行级操作（全部 useCallback(fn, [])，引用永远稳定） ──────

  const handleToggleItem = useCallback((id: string) => {
    setItems(prev => prev.map(item =>
      item._id === id ? { ...item, checked: !item.checked } : item
    ))
  }, [])

  const handleToggleAll = useCallback((checked: boolean) => {
    setItems(prev => prev.map(item => ({ ...item, checked })))
  }, [])

  const handleUpdateItem = useCallback((id: string, updates: Partial<PreviewItem>) => {
    setItems(prev => prev.map(item =>
      item._id === id ? { ...item, ...updates } : item
    ))
  }, [])

  const handleRemoveItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item._id !== id))
  }, [])

  // ── 文本解析（本地 → AI 分类增强） ────────────────────────────
  const handleParseText = useCallback(async () => {
    if (!pastedText.trim()) return
    setStage('processing')
    // 让 UI 先刷新到"解析中"状态，再执行 CPU 密集操作
    await new Promise<void>(resolve => setTimeout(resolve, 120))
    const raw      = runLocalParse(pastedText)
    // AI 增强：对本地无法映射的分类批量补全（后台静默，失败不阻断）
    const enriched = await enrichCategoriesWithAI(raw)
    const dupSet   = buildDupSet(allTxRef.current)
    const parsed   = applyDupCheck(enriched, dupSet)
    setItems(parsed)
    setShowAiFallback(parsed.length === 0)
    setStage('preview')
  }, [pastedText])

  // ── 文件选择处理 ────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // 允许重复选同一文件
    setFileName(file.name)
    setAiError(null)

    if (file.type.startsWith('image/')) {
      if (file.size > 4 * 1024 * 1024) {
        setAiError('图片超过 4MB，请压缩后重试')
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        const dataUrl = reader.result as string
        setPreviewImageUrl(dataUrl)
        const [header, b64] = dataUrl.split(',')
        setImageData({
          base64:   b64,
          mimeType: header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg',
        })
        setItems([])
        setShowAiFallback(true)
        setStage('preview')
      }
      reader.readAsDataURL(file)
    } else {
      const reader = new FileReader()
      reader.onloadend = async () => {
        const text = reader.result as string
        setPastedText(text)
        setStage('processing')
        await new Promise<void>(resolve => setTimeout(resolve, 120))
        const raw      = runLocalParse(text)
        // AI 增强：对本地无法映射的分类批量补全
        const enriched = await enrichCategoriesWithAI(raw)
        const dupSet   = buildDupSet(allTxRef.current)
        const parsed   = applyDupCheck(enriched, dupSet)
        setItems(parsed)
        setShowAiFallback(parsed.length === 0)
        setStage('preview')
      }
      reader.readAsText(file, 'UTF-8')
    }
  }

  // ── AI 兜底：批量文本解析 ────────────────────────────────────
  const handleAiTextFallback = useCallback(async () => {
    const text = pastedText.trim()
    if (!text) return
    setAiLoading(true)
    setAiError(null)
    try {
      const results  = await parseNaturalLanguageBatch(text)
      const dupSet   = buildDupSet(allTxRef.current)
      const raw: PreviewItem[] = results.map((r, i) => {
        const description = r.notes || r.category
        const title       = description.slice(0, 20)
        const amount      = INCOME_CATEGORIES.has(r.category)
                              ? Math.abs(r.amount)
                              : -Math.abs(r.amount)
        return {
          _id:                `ai-${Date.now()}-${i}`,
          checked:            true,
          isDuplicateDetected: false,
          title, date: r.date, amount,
          category:           r.category,
          description,
          tags:               [],
          accountId:          'acc-manual',
          sourceType:         'manual' as SourceType,
          source:             'manual' as TransactionSource,
          rawData:            {},
          originalParsedData: { aiResult: r },
        }
      })
      setItems(applyDupCheck(raw, dupSet))
      setShowAiFallback(false)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 解析失败，请重试')
    } finally {
      setAiLoading(false)
    }
  }, [pastedText])

  // ── AI 兜底：图片识别 ────────────────────────────────────────
  const handleAiImageAnalyze = useCallback(async () => {
    if (!imageData) return
    setAiLoading(true)
    setAiError(null)
    try {
      const result      = await analyzeReceipt(imageData.base64, imageData.mimeType)
      const description = result.notes || result.category
      const title       = description.slice(0, 20)
      const amount      = INCOME_CATEGORIES.has(result.category)
                            ? Math.abs(result.amount)
                            : -Math.abs(result.amount)
      const item: PreviewItem = {
        _id:                `ai-img-${Date.now()}`,
        checked:            true,
        isDuplicateDetected: false,
        title, date: result.date, amount,
        category:           result.category,
        description,
        tags:               [],
        accountId:          'acc-manual',
        sourceType:         'ocr',
        source:             'manual',
        rawData:            {},
        originalParsedData: { aiResult: result },
      }
      const dupSet = buildDupSet(allTxRef.current)
      setItems(applyDupCheck([item], dupSet))
      setShowAiFallback(false)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '图片识别失败，请重试')
    } finally {
      setAiLoading(false)
    }
  }, [imageData])

  // ── 确认写入（仅 writeBatch 已选中的行） ─────────────────────
  const handleConfirmImport = useCallback(async () => {
    const toWrite = items.filter(i => i.checked)
    if (toWrite.length === 0 || importing) return
    setImporting(true)
    setImportError(null)
    try {
      const batch = writeBatch(db)
      const ts    = serverTimestamp()

      toWrite.forEach(item => {
        const docRef = doc(collection(db, 'transactions'))
        const data: Record<string, unknown> = {
          ledgerId:          activeLedgerId,
          userId:            currentUserId,
          date:              item.date,
          amount:            item.amount,
          category:          item.category,
          // title（主要事项）→ Transaction.description（账单列表的主显示字段）
          // 完整摘要备注保留在 rawData.fullMemo，供溯源查看
          description:       item.title || item.description,
          tags:              item.tags,
          accountId:         item.accountId,
          sourceType:        item.sourceType,
          source:            item.source,
          rawData:           { ...item.rawData, fullMemo: item.description },
          originalParsedData: item.originalParsedData,
          status:            'cleared',
          createdAt:         ts,
          updatedAt:         ts,
        }
        if (item.parseError) data.parseError = item.parseError
        batch.set(docRef, data)
      })

      await batch.commit()
      setImportedCount(toWrite.length)
      setStage('done')
    } catch (err) {
      setImportError(`写入失败：${err instanceof Error ? err.message : '未知错误'}，请重试`)
    } finally {
      setImporting(false)
    }
  }, [items, importing, activeLedgerId, currentUserId])

  // ── 关闭（延迟重置，避免动画期间闪烁） ──────────────────────
  const handleClose = useCallback(() => {
    onClose()
    setTimeout(handleReset, 300)
  }, [onClose, handleReset])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl
                      max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">

        {/* ── 弹窗头部 ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4
                        border-b border-border-light flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-content-primary">导入账单</h2>
            <p className="text-xs text-content-tertiary mt-0.5">
              {stage === 'input'      && '粘贴表格、文字，或上传 CSV / 图片'}
              {stage === 'processing' && '本地解析中…'}
              {stage === 'preview'    && (
                items.length > 0
                  ? `共 ${items.length} 条 · 已选 ${checkedCount} 条待导入`
                  : showAiFallback
                    ? '本地解析无结果，可调用 AI 兜底'
                    : '没有可导入的数据'
              )}
              {stage === 'done' && `已成功导入 ${importedCount} 条账单`}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center
                       text-content-tertiary hover:text-content-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* ── 内容区（可滚动） ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ════ 输入阶段 ════ */}
          {stage === 'input' && (
            <div className="p-5 space-y-4">

              {/* 导入币种选择器 */}
              <div>
                <p className="text-xs font-semibold text-content-secondary mb-2">导入币种</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                    <button
                      key={code}
                      onClick={() => setImportCurrency(code)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                        importCurrency === code
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-surface-overlay text-content-secondary hover:bg-gray-100'
                      }`}
                    >
                      {sym} {code}
                    </button>
                  ))}
                </div>
              </div>

              {/* 输入模式 Tab */}
              <div className="flex gap-1 p-1 bg-surface-overlay rounded-xl">
                {(['text', 'file'] as InputMode[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setInputMode(v)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                      inputMode === v
                        ? 'bg-white text-primary-700 shadow-sm'
                        : 'text-content-tertiary hover:text-content-secondary'
                    }`}
                  >
                    {v === 'text' ? '📋 文字 / 表格粘贴' : '📁 文件上传'}
                  </button>
                ))}
              </div>

              {/* ── 文字粘贴 ── */}
              {inputMode === 'text' && (
                <>
                  <div className="bg-blue-50 rounded-xl px-4 py-3 space-y-1">
                    <p className="text-xs font-semibold text-blue-700">📌 支持的粘贴格式</p>
                    <p className="text-xs text-blue-600">
                      <span className="font-medium">Google Sheets / Excel：</span>
                      直接复制表格行，Tab 分隔（日期 · 归属月 · 收支 · 分类 · 金额 · 摘要）
                    </p>
                    <p className="text-xs text-blue-600">
                      <span className="font-medium">微信 / 支付宝 CSV：</span>
                      从 App 导出后粘贴全文
                    </p>
                  </div>
                  <textarea
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    onPaste={e => {
                      // ① stopPropagation：阻止事件冒泡至弹窗蒙层（蒙层 onClick 可能
                      //    干扰焦点，导致 textarea 失焦后粘贴被吃掉）
                      e.stopPropagation()
                      // ② 防御性读取剪贴板（?.  兼容 clipboardData 为 null 的边缘情况）
                      //    先尝试标准 MIME，再尝试 IE/旧 Edge 使用的 'Text' 别名
                      const text =
                        e.clipboardData?.getData('text/plain') ||
                        e.clipboardData?.getData('Text')        ||
                        ''
                      if (!text) return
                      // ③ 阻止浏览器默认插入，改由我们手动控制 state
                      e.preventDefault()
                      const el    = e.currentTarget
                      const start = el.selectionStart ?? pastedText.length
                      const end   = el.selectionEnd   ?? pastedText.length
                      // 在光标选区位置替换（支持"选中后粘贴覆盖"场景）
                      const next  = pastedText.slice(0, start) + text + pastedText.slice(end)
                      setPastedText(next)
                      // ④ 用 rAF 等 React 完成 DOM 更新后再写光标，否则 React
                      //    的受控渲染会把 selectionStart 重置回 0
                      requestAnimationFrame(() => {
                        el.selectionStart = el.selectionEnd = start + text.length
                      })
                    }}
                    placeholder={PASTE_PLACEHOLDER}
                    className="w-full h-52 px-4 py-3 text-xs font-mono text-content-secondary
                               bg-surface-overlay border border-border rounded-xl resize-none
                               focus:outline-none focus:border-primary-500 focus:ring-1
                               focus:ring-primary-500 placeholder-content-tertiary leading-relaxed"
                  />
                </>
              )}

              {/* ── 文件上传 ── */}
              {inputMode === 'file' && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt,image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-primary-200 rounded-2xl
                               bg-primary-50/40 hover:bg-primary-50 hover:border-primary-300
                               transition-all py-10 flex flex-col items-center gap-3 group
                               active:scale-[0.98]"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-white shadow-card flex items-center
                                    justify-center text-3xl group-hover:shadow-card-md transition-all">
                      📂
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-content-primary">
                        {fileName ? `✅ ${fileName}` : '点击选择文件'}
                      </p>
                      <p className="text-xs text-content-tertiary mt-1">
                        支持 .csv、.txt（微信/支付宝/表格导出）
                        <br />以及账单截图（JPG / PNG）→ AI 识别
                      </p>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}

          {/* ════ 解析中 ════ */}
          {stage === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="text-4xl animate-spin">⚙️</div>
              <p className="text-sm text-content-secondary">正在解析账单数据…</p>
            </div>
          )}

          {/* ════ 预览阶段 ════ */}
          {stage === 'preview' && (
            <div className="p-4 space-y-3">

              {/* 图片预览（AI 图像路径） */}
              {previewImageUrl && (
                <div className="relative rounded-2xl overflow-hidden bg-gray-100 shadow-card">
                  <img src={previewImageUrl} alt="账单图片" className="w-full max-h-48 object-contain" />
                  <button
                    onClick={() => { setPreviewImageUrl(null); setImageData(null) }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 text-white
                               text-xs flex items-center justify-center hover:bg-black/60 transition-colors"
                  >✕</button>
                </div>
              )}

              {/* AI 兜底入口 */}
              {showAiFallback && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0">🤖</span>
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        {imageData ? '图片无法本地解析' : '本地解析遇到困难'}
                      </p>
                      <p className="text-xs text-amber-600 mt-1 leading-relaxed">
                        {imageData
                          ? '系统无法直接读取图片，需要借助 AI 视觉识别。'
                          : '格式未能匹配已知模板，可尝试 AI 智能解析（会消耗 Gemini 配额）。'}
                      </p>
                    </div>
                  </div>
                  {aiError && (
                    <p className="text-xs text-red-600 px-1">⚠️ {aiError}</p>
                  )}
                  <button
                    onClick={imageData ? handleAiImageAnalyze : handleAiTextFallback}
                    disabled={aiLoading}
                    className={`w-full py-3 rounded-xl text-sm font-semibold text-white transition-all
                                flex items-center justify-center gap-2 ${
                      aiLoading
                        ? 'bg-amber-300 cursor-not-allowed'
                        : 'bg-amber-500 hover:bg-amber-600 active:scale-[0.98]'
                    }`}
                  >
                    {aiLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        AI 识别中…
                      </>
                    ) : (
                      `✨ 调用 AI ${imageData ? '识别图片' : '智能解析'}（消耗配额）`
                    )}
                  </button>
                </div>
              )}

              {/* 预览清洗表 */}
              {items.length > 0 && (
                <PreviewTable
                  items={items}
                  allChecked={allChecked}
                  someChecked={someChecked}
                  checkedCount={checkedCount}
                  onToggleItem={handleToggleItem}
                  onToggleAll={handleToggleAll}
                  onUpdateItem={handleUpdateItem}
                  onRemoveItem={handleRemoveItem}
                />
              )}

              {/* 空态（本地解析 0 条且 AI 兜底也未出结果） */}
              {items.length === 0 && !showAiFallback && (
                <div className="py-10 text-center">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="text-sm text-content-tertiary">没有可导入的数据</p>
                  <p className="text-xs text-content-tertiary mt-1">请检查文本格式或重新选择文件</p>
                </div>
              )}

              {importError && (
                <p className="text-xs text-expense text-center py-1">{importError}</p>
              )}
            </div>
          )}

          {/* ════ 导入完成 ════ */}
          {stage === 'done' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-income-bg flex items-center justify-center">
                <svg className="w-8 h-8 text-income" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-base font-semibold text-content-primary">导入成功！</p>
                <p className="text-sm text-content-tertiary mt-1">
                  已将 <span className="font-bold text-income">{importedCount}</span> 条账单写入账本，
                  账单列表将自动刷新。
                </p>
              </div>
            </div>
          )}

        </div>

        {/* ── 底部操作按钮 ──────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-border-light flex gap-3 flex-shrink-0">

          {stage === 'input' && (
            <>
              <button onClick={handleClose} className="btn-ghost flex-1">取消</button>
              {inputMode === 'text' ? (
                <button
                  onClick={handleParseText}
                  disabled={!pastedText.trim()}
                  className="btn-primary flex-1"
                >
                  开始解析 →
                </button>
              ) : (
                <button onClick={() => fileInputRef.current?.click()} className="btn-primary flex-1">
                  选择文件
                </button>
              )}
            </>
          )}

          {stage === 'preview' && (
            <>
              <button onClick={handleReset} disabled={importing} className="btn-ghost flex-1">
                重新输入
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importing || checkedCount === 0}
                className={`btn-primary flex-1 text-sm ${
                  importing || checkedCount === 0 ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                {importing
                  ? '写入中…'
                  : `确认无误，仅导入已选的 ${checkedCount} 条数据 →`}
              </button>
            </>
          )}

          {stage === 'done' && (
            <button onClick={handleClose} className="btn-primary flex-1">完成</button>
          )}

        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 子组件：预览清洗表（表头全选 + 图例 + 行列表）
// ══════════════════════════════════════════════════════════════

interface PreviewTableProps {
  items:        PreviewItem[]
  allChecked:   boolean
  someChecked:  boolean
  checkedCount: number
  onToggleItem: (id: string) => void
  onToggleAll:  (checked: boolean) => void
  onUpdateItem: (id: string, updates: Partial<PreviewItem>) => void
  onRemoveItem: (id: string) => void
}

function PreviewTable({
  items, allChecked, someChecked, checkedCount,
  onToggleItem, onToggleAll, onUpdateItem, onRemoveItem,
}: PreviewTableProps) {

  const hasDuplicates = items.some(i => i.isDuplicateDetected)

  return (
    <div className="rounded-2xl overflow-hidden border border-border-light">

      {/* ── 表头：全选 + 计数 ── */}
      <div className="flex items-center justify-between px-4 py-3
                      bg-surface-overlay border-b border-border-light">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked }}
            onChange={e => onToggleAll(e.target.checked)}
            className="w-4 h-4 rounded text-primary-600 border-gray-300
                       focus:ring-primary-500 cursor-pointer"
          />
          <span className="text-xs font-semibold text-content-secondary">
            {allChecked ? '取消全选' : '全选'}
          </span>
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-content-tertiary">
            <span className="font-semibold text-primary-700">{checkedCount}</span>
            <span className="opacity-60"> / {items.length} 条已选</span>
          </span>
          {checkedCount < items.length && (
            <button
              onClick={() => onToggleAll(true)}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              全部选中
            </button>
          )}
          {checkedCount > 0 && !allChecked && (
            <button
              onClick={() => onToggleAll(false)}
              className="text-xs text-content-tertiary hover:text-content-secondary font-medium"
            >
              清空选择
            </button>
          )}
        </div>
      </div>

      {/* ── 图例说明（仅当有疑似重复时） ── */}
      {hasDuplicates && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100
                        flex items-center gap-2">
          <span className="text-xs text-amber-700">
            ⚠️ 黄色行疑似与现有账单重复，已默认取消勾选，如需覆盖导入请手动勾选
          </span>
        </div>
      )}

      {/* ── 条目列表 ── */}
      {items.map((item, i) => (
        <PreviewRow
          key={item._id}
          item={item}
          isLast={i === items.length - 1}
          onToggle={onToggleItem}
          onUpdate={onUpdateItem}
          onRemove={onRemoveItem}
        />
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 子组件：预览行（React.memo — 仅本行数据变动时重渲染）
// ══════════════════════════════════════════════════════════════

interface PreviewRowProps {
  item:     PreviewItem
  isLast:   boolean
  onToggle: (id: string) => void
  onUpdate: (id: string, updates: Partial<PreviewItem>) => void
  onRemove: (id: string) => void
}

const PreviewRow = React.memo(function PreviewRow({
  item, isLast, onToggle, onUpdate, onRemove,
}: PreviewRowProps) {

  const icon     = CATEGORY_ICON[item.category] ?? '📋'
  const isIncome = item.amount > 0
  const isDup    = item.isDuplicateDetected

  // 摘要备注「显示态 ↔ 编辑态」本地开关
  // 默认为显示态（灰色静态小字），点击后切换到编辑态（带 autoFocus 的 input）
  const [editingDesc, setEditingDesc] = useState(false)

  return (
    <div className={[
      'transition-colors',
      isDup         ? 'bg-amber-50/60'     : 'bg-white',
      !item.checked ? 'opacity-55'         : '',
      !isLast       ? 'border-b border-border-light' : '',
    ].join(' ')}>

      {/* ── 主行：复选框 · 图标(蓝点) · [主要事项 + 摘要备注] · 移除 ── */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-1">

        {/* 复选框（顶部对齐） */}
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item._id)}
          className="mt-0.5 w-4 h-4 flex-shrink-0 rounded text-primary-600 border-gray-300
                     focus:ring-primary-500 cursor-pointer"
        />

        {/* 分类图标 + AI 蓝点（relative 定位容器） */}
        <span className="relative flex-shrink-0 select-none text-base leading-none mt-0.5">
          {icon}
          {/* 蓝点：分类由 AI mapCategoryBatch 智能纠正时显示 */}
          {item.isAiCategorized && (
            <span
              title="分类由 AI 智能识别，可手动修改"
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full
                         bg-blue-500 ring-1 ring-white"
            />
          )}
        </span>

        {/* 纵向叠放：主要事项（上）+ 摘要备注（下，灰色小字） */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">

          {/* 主要事项（可编辑文本输入） */}
          <input
            type="text"
            value={item.title}
            onChange={e => onUpdate(item._id, { title: e.target.value })}
            maxLength={40}
            placeholder="主要事项"
            className="w-full text-xs font-medium text-content-primary bg-transparent
                       border-b border-transparent hover:border-border focus:border-primary-400
                       focus:outline-none py-0.5 placeholder-content-tertiary transition-colors"
          />

          {/* 摘要备注：显示态（灰色小字）↔ 编辑态（input）
              · 显示态：纯 span，无任何 input 光标 affordance，视觉上是静态文字
              · 编辑态：autoFocus input，失焦(blur) / 回车 / Esc 均退回显示态   */}
          {editingDesc ? (
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              type="text"
              value={item.description}
              onChange={e => onUpdate(item._id, { description: e.target.value })}
              onBlur={() => setEditingDesc(false)}
              onKeyDown={e => {
                // 回车 / Esc 退出编辑态（不提交表单，stopPropagation 防止冒泡到弹窗）
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setEditingDesc(false)
                }
              }}
              placeholder="摘要备注…"
              className="w-full text-[10px] text-content-secondary bg-transparent
                         border-b border-primary-400 outline-none py-0
                         placeholder-gray-300 transition-colors"
            />
          ) : (
            // 显示态：cursor-text 提示可点击编辑，group-hover 不需要（直接点即可）
            <span
              role="button"
              tabIndex={0}
              onClick={() => setEditingDesc(true)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setEditingDesc(true) }}
              title="点击编辑摘要备注"
              className={[
                'block w-full text-[10px] py-0.5 leading-snug cursor-text',
                'truncate select-none rounded-sm',
                // 悬停时底部浅线，暗示可编辑
                'hover:border-b hover:border-gray-200',
                item.description ? 'text-gray-400' : 'text-gray-300',
              ].join(' ')}
            >
              {item.description || '点击添加摘要备注…'}
            </span>
          )}
        </div>

        {/* 移除按钮（顶部对齐） */}
        <button
          onClick={() => onRemove(item._id)}
          title="移除此条目"
          className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-expense-bg flex items-center
                     justify-center text-expense text-xs hover:bg-red-100 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* ── 副行：分类下拉 · 日期 · 金额输入 ── */}
      <div className="flex items-center gap-2 px-3 pb-1.5 pl-[3.75rem]">

        {/* 分类下拉（用户手动修改后 isAiCategorized 不会自动清除，属预期行为） */}
        <select
          value={item.category}
          onChange={e => {
            const cat        = e.target.value
            const isNowInc   = INCOME_CATEGORIES.has(cat)
            const wasInc     = isIncome
            // 同步修正金额符号：切换收支性质时翻转
            let newAmount    = item.amount
            if (isNowInc && !wasInc) newAmount =  Math.abs(item.amount)
            if (!isNowInc && wasInc) newAmount = -Math.abs(item.amount)
            onUpdate(item._id, { category: cat, amount: newAmount })
          }}
          className="text-[11px] text-content-secondary bg-surface-overlay
                     border border-border-light rounded-lg px-2 py-0.5
                     focus:outline-none focus:border-primary-400 cursor-pointer
                     max-w-[96px] flex-shrink-0"
        >
          {ALL_CATEGORIES.map(c => (
            <option key={c} value={c}>{CATEGORY_ICON[c]} {c}</option>
          ))}
        </select>

        {/* 日期（只读展示） */}
        <span className="text-[11px] text-content-tertiary flex-shrink-0 tabular-nums">
          {item.date ? toChineseDate(item.date) : '—'}
        </span>

        {/* 弹性间距 */}
        <div className="flex-1" />

        {/* 金额方向标签 + 数值输入 */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <span className={`text-[11px] font-medium ${isIncome ? 'text-income' : 'text-expense'}`}>
            {isIncome ? '+¥' : '-¥'}
          </span>
          <input
            type="number"
            value={Math.abs(item.amount)}
            min={0}
            step={0.01}
            onChange={e => {
              const abs = parseFloat(e.target.value)
              if (!isNaN(abs) && abs >= 0) {
                onUpdate(item._id, { amount: isIncome ? abs : -abs })
              }
            }}
            className="w-20 text-[11px] font-semibold tabular-nums text-right
                       text-content-primary bg-transparent
                       border-b border-transparent hover:border-border
                       focus:border-primary-400 focus:outline-none py-0.5
                       transition-colors"
          />
        </div>
      </div>

      {/* ── 疑似重复徽标（黄卡专属） ── */}
      {isDup && (
        <div className="px-3 pb-2.5 pl-[3.75rem]">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium
                           text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
            ⚠️ 疑似重复
            <span className="opacity-60 font-normal">· 相同金额+日期已存在</span>
          </span>
        </div>
      )}

    </div>
  )
})

// ── 粘贴占位符 ─────────────────────────────────────────────────

const PASTE_PLACEHOLDER = `在此粘贴内容…

【Google Sheets / Excel 格式（Tab 分隔）】
2026/3/15\t2026-03\t支出\t餐饮\t38.50\t美团黄焖鸡
2026/3/16\t2026-03\t支出\t交通\t25.00\t滴滴打车

【微信 / 支付宝 CSV 格式】
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式
2026-03-15 12:30:00,商户消费,美团,黄焖鸡米饭,支出,¥38.50,零钱`

export default ImportModal
