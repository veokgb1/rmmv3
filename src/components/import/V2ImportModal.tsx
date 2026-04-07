// V2ImportModal — V2 历史数据可视化导入引擎 (S21 重构版)
//
// 流程（五步状态机）：
//   select_ledger → input_data → preview → importing → done
//
// 架构原则：
//   · 所有 handler 在 if (!isOpen) return null 之前定义，彻底避免闭包/提升歧义
//   · 每个 handler 内部加 console.error 保证任何失败均可在控制台追踪
//   · 所有失败路径均有明确的 setErrorMsg，不存在"无声退出"
//   · 账套强制前置 + 可内嵌新建账套（无需跳转）
//   · sourceType: 'V2_to_V3' 打标 / rawData.legacy_backup 垃圾袋隔离
//   · 所有文字颜色使用硬编码 text-slate-* 绕过 CSS variable 暗模式问题

import { useState, useRef }                     from 'react'
import { useLedger }                            from '@/hooks/useLedger'
import { useAuthStore }                         from '@/store/authStore'
import {
  parseV2JSON, batchImportV2,
  importV2Evidences, deleteV2Records,
}                                               from '@/services/v2ImportService'
import type {
  V2ParseResult, ImportResult, CleanupResult,
}                                               from '@/services/v2ImportService'
import { createLedger }                         from '@/services/firebase/ledgerService'
import type { LedgerType }                      from '@/types/Ledger.types'

// ════════════════════════════════════════════════════════════════
// § 0  Demo 数据（5 条，覆盖多字段变体，供测试用）
// ════════════════════════════════════════════════════════════════

const DEMO_V2_JSON = JSON.stringify([
  { "date": "2024-01-15", "amount": -38.50, "category": "餐饮",  "memo": "星巴克拿铁" },
  { "date": "2024-01-16", "amount": -12.00, "type": "交通",      "remark": "滴滴打车" },
  { "date": "2024-01-20", "amount": 5000.00,"category": "工资",  "type": "收入", "description": "1月薪资" },
  { "date": "2024-02-03", "amount": -299.00,"category": "购物",  "note": "京东下单" },
  { "date": "2024-02-14", "amount": -88.00, "category": "娱乐",  "memo": "情人节电影" },
], null, 2)

// ════════════════════════════════════════════════════════════════
// § 1  状态机类型
// ════════════════════════════════════════════════════════════════

type ImportStep =
  | 'select_ledger'
  | 'input_data'
  | 'preview'
  | 'importing'
  | 'done'

type ImportPhase = 'text' | 'evidence'   // importing 阶段内部子阶段

type CleanupState = 'idle' | 'running' | 'done' | 'error'

// ════════════════════════════════════════════════════════════════
// § 2  步骤进度条
// ════════════════════════════════════════════════════════════════

const STEP_LABELS: Record<string, string> = {
  select_ledger: '选择账套',
  input_data:    '导入数据',
  preview:       '预览确认',
  done:          '完成',
}
const VISIBLE_STEPS: ImportStep[] = ['select_ledger', 'input_data', 'preview', 'done']

function StepBar({ current }: { current: ImportStep }) {
  const effective  = current === 'importing' ? 'preview' : current
  const currentIdx = VISIBLE_STEPS.indexOf(effective)

  return (
    <div className="flex items-center px-5 py-3 border-b border-slate-200">
      {VISIBLE_STEPS.map((step, i) => {
        const idx      = VISIBLE_STEPS.indexOf(step)
        const isDone   = idx < currentIdx
        const isActive = step === effective
        const isLast   = i === VISIBLE_STEPS.length - 1

        return (
          <div key={step} className="flex items-center flex-1">
            <div className={[
              'flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0',
              'text-[10px] font-bold transition-all',
              isDone
                ? 'bg-green-500 text-white'
                : isActive
                ? 'bg-primary-600 text-white ring-2 ring-primary-200'
                : 'bg-slate-100 text-slate-400 border border-slate-200',
            ].join(' ')}>
              {isDone ? '✓' : i + 1}
            </div>
            <span className={[
              'ml-1 text-[10px] font-medium whitespace-nowrap',
              isActive ? 'text-primary-600' : isDone ? 'text-green-600' : 'text-slate-400',
            ].join(' ')}>
              {STEP_LABELS[step]}
            </span>
            {!isLast && (
              <div className={['flex-1 h-0.5 mx-2', isDone ? 'bg-green-300' : 'bg-slate-200'].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 3  主组件
// ════════════════════════════════════════════════════════════════

interface V2ImportModalProps {
  isOpen:     boolean
  onClose:    () => void
  showToast?: (msg: string, type?: 'success' | 'warning' | 'error') => void
}

export default function V2ImportModal({ isOpen, onClose, showToast }: V2ImportModalProps) {

  // ── Store ───────────────────────────────────────────────────
  const { ledgers, activeLedgerId } = useLedger()
  const user = useAuthStore(s => s.user)

  // ── 步骤状态 ─────────────────────────────────────────────────
  const [step,           setStep]           = useState<ImportStep>('select_ledger')
  const [targetLedgerId, setTargetLedgerId] = useState<string>('')

  // ── 新建账套 mini-form ──────────────────────────────────────
  const [showNewLedger,     setShowNewLedger]     = useState(false)
  const [newName,           setNewName]           = useState('')
  const [newType,           setNewType]           = useState<LedgerType>('personal')
  const [newCcy,            setNewCcy]            = useState('CNY')
  const [newLedgerCreating, setNewLedgerCreating] = useState(false)

  // ── 第二步：输入 ─────────────────────────────────────────────
  const [jsonText,    setJsonText]    = useState('')
  const [parseResult, setParseResult] = useState<V2ParseResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 第三/四步：导入进度 ──────────────────────────────────────
  const [importPhase,    setImportPhase]    = useState<ImportPhase>('text')
  const [importProgress, setImportProgress] = useState(0)
  const [importResult,   setImportResult]   = useState<ImportResult | null>(null)
  const [evidenceResult, setEvidenceResult] = useState<{ uploaded: number; skipped: number } | null>(null)

  // ── 清场工具 ─────────────────────────────────────────────────
  const [showCleanup,    setShowCleanup]    = useState(false)
  const [cleanupState,   setCleanupState]   = useState<CleanupState>('idle')
  const [cleanupResult,  setCleanupResult]  = useState<CleanupResult | null>(null)
  const [cleanupProgress,setCleanupProgress]= useState(0)

  // ── 通用错误消息 ─────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState('')

  // ────────────────────────────────────────────────────────────
  // 辅助
  // ────────────────────────────────────────────────────────────
  function showErr(msg: string) {
    console.error('[V2ImportModal]', msg)
    setErrorMsg(msg)
  }
  function clearErr() { setErrorMsg('') }

  function resetAll() {
    setStep('select_ledger')
    setTargetLedgerId(activeLedgerId ?? '')
    setShowNewLedger(false)
    setNewName(''); setNewType('personal'); setNewCcy('CNY')
    setNewLedgerCreating(false)
    setJsonText(''); setParseResult(null)
    setImportPhase('text')
    setImportProgress(0); setImportResult(null); setEvidenceResult(null)
    setShowCleanup(false)
    setCleanupState('idle'); setCleanupResult(null); setCleanupProgress(0)
    clearErr()
  }

  function handleClose() {
    if (step === 'importing') return
    onClose()
    setTimeout(resetAll, 300)
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose()
  }

  // ────────────────────────────────────────────────────────────
  // 第一步 A：选择已有账套并前进
  // ────────────────────────────────────────────────────────────
  function handleLedgerConfirm() {
    if (!targetLedgerId) {
      showErr('请先选择一个目标账套，或点击「新建账套」创建新账套')
      return
    }
    clearErr()
    setStep('input_data')
  }

  // ────────────────────────────────────────────────────────────
  // 第一步 B：新建账套 mini-form 提交
  // ────────────────────────────────────────────────────────────
  async function handleCreateLedger() {
    if (!newName.trim()) { showErr('账套名称不能为空'); return }
    if (!user) { showErr('用户未登录，无法创建账套'); return }
    setNewLedgerCreating(true)
    clearErr()
    try {
      const newId = await createLedger(user.uid, {
        name:     newName.trim(),
        type:     newType,
        currency: newCcy,
        timezone: 'Asia/Shanghai',
      })
      console.info('[V2ImportModal] 新账套已创建，ID:', newId)
      setTargetLedgerId(newId)
      setShowNewLedger(false)
      setNewName('')
      setStep('input_data')
    } catch (e) {
      showErr(e instanceof Error ? e.message : '创建账套失败，请重试')
    } finally {
      setNewLedgerCreating(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // 第二步：文件上传
  // ────────────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      showErr('请上传 .json 格式的文件')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      showErr('文件过大（上限 10 MB）')
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? '')
      console.info('[V2ImportModal] 文件读取完成，字符数:', text.length)
      setJsonText(text)
      clearErr()
    }
    reader.onerror = () => showErr('文件读取失败，请重试')
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  // ────────────────────────────────────────────────────────────
  // 第二步：加载 Demo 数据
  // ────────────────────────────────────────────────────────────
  function handleLoadDemo() {
    setJsonText(DEMO_V2_JSON)
    clearErr()
    console.info('[V2ImportModal] 已加载 Demo 数据（5 条样本）')
    showToast?.('已填入 5 条测试样本，点击「解析数据」继续', 'success')
  }

  // ────────────────────────────────────────────────────────────
  // 第二步：解析 JSON 并进入预览
  // ────────────────────────────────────────────────────────────
  function handleParse() {
    const trimmed = jsonText.trim()
    if (!trimmed) { showErr('请先粘贴或上传 V2 数据'); return }
    clearErr()
    console.info('[V2ImportModal] 开始解析，输入长度:', trimmed.length)

    let result: V2ParseResult
    try {
      result = parseV2JSON(trimmed)
    } catch (e) {
      showErr(e instanceof Error ? e.message : 'JSON 解析异常，请检查数据格式')
      return
    }

    console.info('[V2ImportModal] 解析结果 — 有效:', result.records.length, '跳过:', result.skipCount, '错误:', result.errors)
    setParseResult(result)

    if (result.records.length === 0) {
      const msg = result.errors.length > 0
        ? result.errors.join('；')
        : '没有解析到有效记录（所有记录金额为 0 或格式无效）'
      showErr(msg)
      return
    }
    setStep('preview')
  }

  // ────────────────────────────────────────────────────────────
  // 第三步：确认并执行 Firestore 批量写入（文字 + 凭证两阶段）
  // ────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!parseResult) { showErr('解析结果丢失，请返回重新解析'); return }
    if (parseResult.records.length === 0) { showErr('没有可导入的有效记录'); return }
    if (!user) { showErr('用户未登录，请刷新页面后重试'); return }
    if (!targetLedgerId) { showErr('目标账套 ID 为空，请返回第一步重新选择'); return }

    console.info('[V2ImportModal] 开始导入 →', targetLedgerId, '记录数:', parseResult.records.length)
    setStep('importing')
    setImportPhase('text')
    setImportProgress(0)
    clearErr()

    try {
      // ── 阶段 1：文字批量写入 ────────────────────────────────
      const textResult = await batchImportV2(
        parseResult.records,
        targetLedgerId,
        user.uid,
        (imported, total) => {
          setImportProgress(total > 0 ? Math.round((imported / total) * 100) : 100)
        },
      )
      setImportResult(textResult)
      console.info('[V2ImportModal] 文字导入完成 — 成功:', textResult.imported, '失败:', textResult.errors.length)

      // ── 阶段 2：凭证图片上传 ────────────────────────────────
      setImportPhase('evidence')
      setImportProgress(0)
      const evResult = await importV2Evidences(
        parseResult.records,
        textResult.txDocIds,
        targetLedgerId,
        user.uid,
        (done, total) => {
          setImportProgress(total > 0 ? Math.round((done / total) * 100) : 100)
        },
      )
      setEvidenceResult({ uploaded: evResult.uploaded, skipped: evResult.skipped })
      console.info('[V2ImportModal] 凭证导入完成 — 上传:', evResult.uploaded, '跳过:', evResult.skipped)

      setStep('done')
      if (textResult.errors.length === 0) {
        showToast?.(`✅ 成功导入 ${textResult.imported} 条，凭证 ${evResult.uploaded} 张`, 'success')
      } else {
        showToast?.(`⚠️ 导入完成，${textResult.errors.length} 条写入失败`, 'warning')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '导入时发生未知错误，请重试'
      console.error('[V2ImportModal] 导入异常:', e)
      showErr(msg)
      setStep('preview')
    }
  }

  // ────────────────────────────────────────────────────────────
  // 清场：精准删除 V2_to_V3 数据
  // ────────────────────────────────────────────────────────────
  async function handleCleanup() {
    if (!targetLedgerId) { showErr('请先在步骤一选择账套'); return }
    if (!user) { showErr('用户未登录'); return }

    setCleanupState('running')
    setCleanupProgress(0)
    setCleanupResult(null)
    clearErr()
    console.info('[V2ImportModal] 开始清场 — 账套:', targetLedgerId)

    try {
      const result = await deleteV2Records(
        targetLedgerId,
        (deleted, total) => {
          setCleanupProgress(total > 0 ? Math.round((deleted / total) * 100) : 100)
        },
      )
      setCleanupResult(result)
      setCleanupState('done')
      console.info('[V2ImportModal] 清场完成:', result)
      showToast?.(`🗑️ 已清除 ${result.deleted} 条 V2 迁移记录`, 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '清场时发生未知错误'
      console.error('[V2ImportModal] 清场异常:', e)
      showErr(msg)
      setCleanupState('error')
    }
  }

  // ════════════════════════════════════════════════════════════
  // 渲染守卫（必须在所有 hooks / 函数之后）
  // ════════════════════════════════════════════════════════════
  if (!isOpen) return null

  // ── 派生数据 ─────────────────────────────────────────────────
  const targetLedger = ledgers.find(l => l.id === targetLedgerId)

  const previewStats = (parseResult && parseResult.records.length > 0) ? (() => {
    const r        = parseResult.records
    const expenses = r.filter(x => x.amount < 0)
    const incomes  = r.filter(x => x.amount >= 0)
    const dates    = r.map(x => x.date).sort()
    return {
      total:    r.length,
      expenses: expenses.length,
      incomes:  incomes.length,
      totalExp: expenses.reduce((s, x) => s + Math.abs(x.amount), 0).toFixed(2),
      totalInc: incomes.reduce((s, x) => s + x.amount, 0).toFixed(2),
      earliest: dates[0] ?? '—',
      latest:   dates[dates.length - 1] ?? '—',
    }
  })() : null

  // ════════════════════════════════════════════════════════════
  // JSX
  // ════════════════════════════════════════════════════════════
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center px-4"
      onClick={handleBackdrop}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* 弹窗本体 */}
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl
                   overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 顶部色带 */}
        <div className="h-1 w-full bg-gradient-to-r from-primary-500 via-blue-400 to-primary-500" />

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">📦 导入 V2 历史数据</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              将旧版账单迁移至 V3 账套，自动进入冲突验证队列
            </p>
          </div>
          {step !== 'importing' && (
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-full
                         text-slate-400 hover:text-slate-700
                         hover:bg-slate-100 transition-colors text-lg leading-none"
            >×</button>
          )}
        </div>

        {/* 步骤进度条 */}
        <StepBar current={step} />

        {/* ── 主体内容（可滚动）─────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* 通用错误提示 */}
          {errorMsg && (
            <div className="mx-5 mt-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl
                            flex items-start gap-2">
              <span className="text-sm flex-shrink-0 mt-0.5">⚠️</span>
              <p className="text-xs text-red-600 leading-snug">{errorMsg}</p>
            </div>
          )}

          {/* ══════════ 第一步：选择账套 ══════════ */}
          {step === 'select_ledger' && !showNewLedger && (
            <div className="px-5 py-4 space-y-4">

              {/* 导入须知 */}
              <div className="px-3 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-xs text-blue-700 font-medium leading-relaxed">📋 导入须知</p>
                <ul className="mt-1.5 space-y-1 text-xs text-blue-600 leading-relaxed">
                  <li>· 所有记录打上 <code className="bg-blue-100 px-1 rounded">V2_to_V3</code> 来源标记，进入「待验证」队列</li>
                  <li>· V2 旧字段封存于 <code className="bg-blue-100 px-1 rounded">legacy_backup</code>，不污染 V3 统计</li>
                </ul>
              </div>

              {/* 账套列表 */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">
                  选择目标账套 <span className="text-red-500">*</span>
                </p>
                <div className="space-y-2">
                  {ledgers.map(ledger => (
                    <button
                      key={ledger.id}
                      onClick={() => { setTargetLedgerId(ledger.id); clearErr() }}
                      className={[
                        'w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left',
                        targetLedgerId === ledger.id
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-slate-200 bg-white hover:border-primary-300 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div className={[
                        'w-8 h-8 rounded-full flex items-center justify-center',
                        'text-sm font-bold flex-shrink-0',
                        targetLedgerId === ledger.id
                          ? 'bg-primary-500 text-white'
                          : 'bg-slate-100 text-slate-600',
                      ].join(' ')}>
                        {ledger.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {ledger.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {ledger.currency} · {ledger.type}
                        </p>
                      </div>
                      {targetLedgerId === ledger.id && (
                        <span className="text-primary-500 text-lg flex-shrink-0">✓</span>
                      )}
                    </button>
                  ))}

                  {ledgers.length === 0 && (
                    <div className="py-4 text-center">
                      <p className="text-sm text-slate-500">暂无可用账套</p>
                      <p className="text-xs text-slate-400 mt-1">请点击下方「+ 新建账套」</p>
                    </div>
                  )}

                  {/* 新建账套入口 */}
                  <button
                    onClick={() => { setShowNewLedger(true); clearErr() }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                               border-2 border-dashed border-primary-300 bg-transparent
                               text-primary-600 hover:bg-primary-50 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center
                                    justify-center text-base font-bold flex-shrink-0">+</div>
                    <span className="text-sm font-medium">新建账套</span>
                  </button>
                </div>
              </div>

              {/* ── 危险区：清场工具 ─────────────────────────── */}
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowCleanup(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5
                             bg-red-50 hover:bg-red-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🗑️</span>
                    <span className="text-xs font-semibold text-red-700">危险区：清空已迁移数据</span>
                  </div>
                  <span className="text-red-400 text-sm">{showCleanup ? '▲' : '▼'}</span>
                </button>

                {showCleanup && (
                  <div className="px-4 py-3 bg-white space-y-3">
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      将删除当前选中账套下<strong className="text-red-600"> 所有 sourceType=V2_to_V3 </strong>
                      的账单记录及其凭证。<strong>原生 V3 数据不受影响。</strong>
                    </p>

                    {!targetLedgerId && (
                      <p className="text-[11px] text-amber-600">⚠️ 请先在上方选择一个账套</p>
                    )}

                    {targetLedgerId && (
                      <p className="text-[11px] text-slate-500">
                        目标：<strong className="text-slate-800">{targetLedger?.name ?? targetLedgerId}</strong>
                      </p>
                    )}

                    {cleanupState === 'idle' || cleanupState === 'error' ? (
                      <button
                        onClick={() => { void handleCleanup() }}
                        disabled={!targetLedgerId}
                        className="w-full py-2 rounded-lg text-xs font-bold
                                   bg-red-600 text-white hover:bg-red-700
                                   transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        🗑️ 确认清空已迁移数据
                      </button>
                    ) : cleanupState === 'running' ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 animate-spin text-red-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-xs text-red-600">清场中… {cleanupProgress}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 rounded-full transition-all duration-300"
                            style={{ width: `${cleanupProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : cleanupState === 'done' && cleanupResult ? (
                      <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-xs text-green-700">
                          ✅ 清场完成：删除账单 <strong>{cleanupResult.deleted}</strong> 条，
                          凭证 <strong>{cleanupResult.evidencesCleaned}</strong> 张
                        </p>
                        <button
                          onClick={() => { setCleanupState('idle'); setCleanupResult(null) }}
                          className="mt-1.5 text-[11px] text-slate-500 hover:text-slate-700 underline"
                        >
                          重置清场状态
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ══════════ 第一步：新建账套 mini-form ══════════ */}
          {step === 'select_ledger' && showNewLedger && (
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowNewLedger(false); clearErr() }}
                  className="text-xs text-primary-600 hover:underline flex items-center gap-0.5"
                >
                  ‹ 返回选择
                </button>
                <span className="text-slate-400 text-xs">/</span>
                <h3 className="text-sm font-semibold text-slate-900">新建账套</h3>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">
                  账套名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => { setNewName(e.target.value); clearErr() }}
                  placeholder="例如：我的个人账本"
                  maxLength={30}
                  autoFocus
                  className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm
                             text-slate-900 border-2 border-transparent
                             focus:border-primary-300 focus:bg-white
                             outline-none transition-all placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">账套类型</label>
                <div className="flex gap-2">
                  {([
                    ['personal',   '👤 个人'],
                    ['family',     '🏡 家庭'],
                    ['enterprise', '🏢 企业'],
                  ] as [LedgerType, string][]).map(([t, label]) => (
                    <button
                      key={t}
                      onClick={() => setNewType(t)}
                      className={[
                        'flex-1 py-2 rounded-xl text-xs font-medium transition-all border',
                        newType === t
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-primary-300',
                      ].join(' ')}
                    >{label}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">货币</label>
                <select
                  value={newCcy}
                  onChange={e => setNewCcy(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-100 rounded-xl text-sm
                             text-slate-900 border-2 border-transparent
                             focus:border-primary-300 focus:bg-white
                             outline-none transition-all"
                >
                  {[
                    ['CNY', '¥ 人民币 CNY'],
                    ['CAD', 'CA$ 加拿大元 CAD'],
                    ['USD', 'US$ 美元 USD'],
                    ['HKD', 'HK$ 港元 HKD'],
                    ['EUR', '€ 欧元 EUR'],
                    ['JPY', '¥ 日元 JPY'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ══════════ 第二步：输入数据 ══════════ */}
          {step === 'input_data' && (
            <div className="px-5 py-4 space-y-4">

              {/* 目标账套确认条 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100
                              rounded-xl border border-slate-200">
                <span className="text-base">🗂️</span>
                <p className="text-xs text-slate-600">
                  导入至：
                  <strong className="text-slate-900 ml-1">
                    {targetLedger?.name ?? targetLedgerId}
                  </strong>
                </p>
                <button
                  onClick={() => { setStep('select_ledger'); clearErr() }}
                  className="ml-auto text-[11px] text-primary-600 hover:underline"
                >更换</button>
              </div>

              {/* Demo 数据测试按钮（醒目）*/}
              <button
                onClick={handleLoadDemo}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                           border-2 border-amber-400 bg-amber-50
                           hover:bg-amber-100 transition-all text-left"
              >
                <span className="text-2xl flex-shrink-0">🧪</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-800">执行预设 Demo 数据测试</p>
                  <p className="text-[11px] text-amber-600">
                    填入 5 条样本（餐饮/交通/工资/购物/娱乐），一键验证导入流程
                  </p>
                </div>
                <span className="text-amber-500 text-lg flex-shrink-0">→</span>
              </button>

              {/* 分隔 */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] text-slate-400">或手动输入</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* 方式一：文件上传 */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">上传 JSON 文件</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                             border-2 border-dashed border-slate-200
                             hover:border-primary-400 hover:bg-primary-50/50
                             transition-all text-left"
                >
                  <span className="text-2xl">📁</span>
                  <div>
                    <p className="text-sm text-slate-600 font-medium">点击选择 JSON 文件</p>
                    <p className="text-[11px] text-slate-400">支持 Firebase 导出格式 · 上限 10 MB</p>
                  </div>
                </button>
                {jsonText.length > 0 && (
                  <p className="text-[11px] text-green-600 mt-1 px-1">
                    ✓ 已载入 {jsonText.length.toLocaleString()} 字符
                  </p>
                )}
              </div>

              {/* 方式二：粘贴 JSON */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">粘贴 JSON 数据</p>
                <textarea
                  value={jsonText}
                  onChange={e => { setJsonText(e.target.value); clearErr() }}
                  placeholder={`粘贴 V2 导出的 JSON 数组，例如：\n[\n  { "date": "2024-01-01", "amount": 38.5, "category": "餐饮", "memo": "午饭" },\n  ...\n]`}
                  rows={6}
                  className="w-full px-4 py-3 bg-slate-100 rounded-xl text-xs
                             text-slate-900 font-mono
                             border-2 border-transparent focus:border-primary-300
                             focus:bg-white outline-none resize-none
                             placeholder:text-slate-400 transition-all"
                />
              </div>

            </div>
          )}

          {/* ══════════ 第三步：预览确认 ══════════ */}
          {step === 'preview' && parseResult && previewStats && (
            <div className="px-5 py-4 space-y-4">

              {/* 目标账套 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100
                              rounded-xl border border-slate-200">
                <span className="text-base">🗂️</span>
                <p className="text-xs text-slate-600">
                  导入至：
                  <strong className="text-slate-900 ml-1">
                    {targetLedger?.name ?? targetLedgerId}
                  </strong>
                </p>
              </div>

              {/* 统计摘要 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="px-3 py-3 bg-slate-100 rounded-xl">
                  <p className="text-[10px] text-slate-500">有效记录</p>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                    {previewStats.total}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    支出 {previewStats.expenses} · 收入 {previewStats.incomes}
                  </p>
                </div>
                <div className="px-3 py-3 bg-slate-100 rounded-xl">
                  <p className="text-[10px] text-slate-500">跳过记录</p>
                  <p className="text-2xl font-bold text-orange-500 tabular-nums mt-0.5">
                    {parseResult.skipCount}
                  </p>
                  <p className="text-[10px] text-slate-500">金额为 0 或格式无效</p>
                </div>
                <div className="px-3 py-3 bg-red-50 rounded-xl">
                  <p className="text-[10px] text-red-500">总支出</p>
                  <p className="text-xl font-bold text-red-600 tabular-nums mt-0.5">
                    ¥{previewStats.totalExp}
                  </p>
                </div>
                <div className="px-3 py-3 bg-green-50 rounded-xl">
                  <p className="text-[10px] text-green-600">总收入</p>
                  <p className="text-xl font-bold text-green-600 tabular-nums mt-0.5">
                    ¥{previewStats.totalInc}
                  </p>
                </div>
              </div>

              {/* 日期范围 */}
              <div className="px-3 py-2.5 bg-slate-100 rounded-xl flex items-center gap-3">
                <span className="text-base">📅</span>
                <p className="text-xs text-slate-600">
                  日期范围：
                  <strong className="text-slate-900">{previewStats.earliest}</strong>
                  <span className="mx-1.5 text-slate-400">→</span>
                  <strong className="text-slate-900">{previewStats.latest}</strong>
                </p>
              </div>

              {/* 解析警告（如有）*/}
              {parseResult.errors.length > 0 && (
                <div className="px-3 py-2.5 bg-yellow-50 border border-yellow-200 rounded-xl">
                  <p className="text-xs font-semibold text-yellow-700 mb-1">解析警告：</p>
                  {parseResult.errors.map((e, i) => (
                    <p key={i} className="text-[11px] text-yellow-600 leading-snug">{e}</p>
                  ))}
                </div>
              )}

              {/* 导入策略说明 */}
              <div className="px-3 py-2.5 bg-primary-50 border border-primary-200 rounded-xl">
                <p className="text-[11px] text-primary-700 leading-relaxed">
                  ⚡ 导入完成后，所有记录自动进入【冲突中心】「待验证」队列。
                  V2 原始字段封装至 <code className="bg-primary-100 px-0.5 rounded">legacy_backup</code>，不影响 V3 统计。
                </p>
              </div>

              {/* 数据样本（前 3 条）*/}
              <div>
                <p className="text-[11px] text-slate-500 font-medium mb-2">
                  数据样本（前 {Math.min(3, previewStats.total)} 条）：
                </p>
                <div className="space-y-1.5">
                  {parseResult.records.slice(0, 3).map((r, i) => (
                    <div key={i}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl">
                      <span className="text-xs text-slate-500 w-14 flex-shrink-0 tabular-nums">
                        {r.date}
                      </span>
                      <span className={[
                        'text-xs font-semibold tabular-nums flex-shrink-0 w-20 text-right',
                        r.amount < 0 ? 'text-red-500' : 'text-green-600',
                      ].join(' ')}>
                        {r.amount < 0 ? '-' : '+'}¥{Math.abs(r.amount).toFixed(2)}
                      </span>
                      <span className="text-[11px] text-slate-500 flex-shrink-0">
                        {r.category}
                      </span>
                      <span className="text-[11px] text-slate-700 truncate flex-1">
                        {r.description || '（无备注）'}
                      </span>
                    </div>
                  ))}
                  {previewStats.total > 3 && (
                    <p className="text-[11px] text-slate-400 text-center py-1">
                      还有 {previewStats.total - 3} 条…
                    </p>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ══════════ 第四步：导入进行中 ══════════ */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 px-5 gap-5">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-primary-200
                                border-t-primary-500 animate-spin" />
                <div className="absolute inset-2 rounded-full bg-primary-50
                                flex items-center justify-center text-2xl">
                  {importPhase === 'evidence' ? '🖼️' : '📦'}
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-800">
                  {importPhase === 'evidence' ? '正在迁移凭证图片…' : '正在批量写入云端…'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {parseResult ? `共 ${parseResult.records.length} 条记录` : ''}
                </p>
              </div>
              <div className="w-full max-w-xs">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full transition-all duration-500"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
                <p className="text-center text-[11px] text-slate-500 mt-1 tabular-nums">
                  {importProgress}%
                </p>
              </div>
              {importPhase === 'evidence' && (
                <p className="text-[11px] text-slate-400">文字账单已入库，正在迁移图片凭证…</p>
              )}
            </div>
          )}

          {/* ══════════ 完成 ══════════ */}
          {step === 'done' && importResult && (
            <div className="px-5 py-6 space-y-4">
              <div className="text-center">
                <span className="text-5xl block mb-3">
                  {importResult.errors.length === 0 ? '🎉' : '⚠️'}
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {importResult.errors.length === 0 ? '导入完成！' : '部分导入完成'}
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  成功导入{' '}
                  <strong className="text-primary-600">{importResult.imported}</strong>{' '}
                  条历史记录
                  {importResult.errors.length > 0 && `，${importResult.errors.length} 条失败`}
                </p>
                {evidenceResult && evidenceResult.uploaded > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    凭证图片：上传 {evidenceResult.uploaded} 张
                    {evidenceResult.skipped > 0 && `，跳过 ${evidenceResult.skipped} 张`}
                  </p>
                )}
              </div>

              <div className="px-4 py-3 bg-primary-50 border border-primary-200 rounded-xl">
                <p className="text-xs text-primary-700 leading-relaxed">
                  🛡️ 所有导入记录已进入【冲突中心 → 待验证】队列，请前往审核并逐一确认。
                </p>
              </div>

              {importResult.errors.length > 0 && (
                <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl space-y-1">
                  <p className="text-xs font-semibold text-red-600">失败记录（前 5 条）：</p>
                  {importResult.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-[11px] text-red-500 leading-snug">{e}</p>
                  ))}
                  {importResult.errors.length > 5 && (
                    <p className="text-[11px] text-red-400">…还有 {importResult.errors.length - 5} 条</p>
                  )}
                </div>
              )}

              {/* 清场工具（完成后也可清场，用于测试重跑）*/}
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowCleanup(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5
                             bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <span className="text-xs font-semibold text-red-700">🗑️ 撤销此次迁移（清空已迁移数据）</span>
                  <span className="text-red-400 text-sm">{showCleanup ? '▲' : '▼'}</span>
                </button>
                {showCleanup && (
                  <div className="px-4 py-3 bg-white space-y-3">
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      删除 <strong className="text-slate-900">{targetLedger?.name ?? targetLedgerId}</strong> 下
                      所有 <code className="bg-slate-100 px-1 rounded">V2_to_V3</code> 记录，原生数据不受影响。
                    </p>
                    {cleanupState === 'idle' || cleanupState === 'error' ? (
                      <button
                        onClick={() => { void handleCleanup() }}
                        className="w-full py-2 rounded-lg text-xs font-bold
                                   bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >🗑️ 确认清空</button>
                    ) : cleanupState === 'running' ? (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 animate-spin text-red-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-red-600">清场中… {cleanupProgress}%</span>
                      </div>
                    ) : cleanupState === 'done' && cleanupResult ? (
                      <p className="text-xs text-green-700">
                        ✅ 已删除 {cleanupResult.deleted} 条记录，{cleanupResult.evidencesCleaned} 张凭证
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
        {/* 主体内容结束 */}

        {/* ══ 底部操作栏 ══════════════════════════════════════════ */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-5
                        border-t border-slate-200 flex-shrink-0">

          {/* 左侧：取消 / 关闭 */}
          {step !== 'importing' && (
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium
                         bg-slate-100 text-slate-600
                         hover:bg-slate-200 transition-colors"
            >
              {step === 'done' ? '关闭' : '取消'}
            </button>
          )}

          {/* 步骤1 — 新建账套表单确认 */}
          {step === 'select_ledger' && showNewLedger && (
            <button
              onClick={() => { void handleCreateLedger() }}
              disabled={!newName.trim() || newLedgerCreating}
              className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                         bg-primary-600 text-white hover:bg-primary-700
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {newLedgerCreating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>创建中…</span>
                </>
              ) : '✨ 创建并继续'}
            </button>
          )}

          {/* 步骤1 — 下一步 */}
          {step === 'select_ledger' && !showNewLedger && (
            <button
              onClick={handleLedgerConfirm}
              disabled={!targetLedgerId}
              className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                         bg-primary-600 text-white hover:bg-primary-700
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步 →
            </button>
          )}

          {/* 步骤2 — 解析数据 */}
          {step === 'input_data' && (
            <button
              onClick={handleParse}
              disabled={!jsonText.trim()}
              className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                         bg-primary-600 text-white hover:bg-primary-700
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              解析数据 →
            </button>
          )}

          {/* 步骤3 — 确认导入 */}
          {step === 'preview' && parseResult && (
            <button
              onClick={() => { void handleImport() }}
              className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                         bg-green-600 text-white hover:bg-green-700
                         transition-colors flex items-center justify-center gap-2"
            >
              <span>📦</span>
              <span>确认导入 {parseResult.records.length} 条</span>
            </button>
          )}

          {/* 完成 — 前往治理中心 */}
          {step === 'done' && (
            <button
              onClick={() => {
                handleClose()
                showToast?.('请前往【治理中心】核实导入记录', 'success')
              }}
              className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                         bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              🛡️ 前往治理中心
            </button>
          )}

        </div>

      </div>
    </div>
  )
}
