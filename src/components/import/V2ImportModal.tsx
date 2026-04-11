// V2ImportModal.tsx — V2 历史数据可视化导入引擎 (S21 深度重构版)
//
// 新增特性：
//   1. sessionStorage 断点续传  — 关闭弹窗后重开，剩余队列不丢失（24h TTL）
//   2. 复选框分批导入           — 可选任意子集，导入后精准扣减队列
//   3. 实时进度统计             — 顶部始终显示"已成功导入 X 条 / 剩余 Y 条"
//   4. 所有文字强制 text-slate-xxx，彻底消除白底不可见文字
//
// 导入状态机：
//   select_ledger → input_data → preview ⟲ importing → done
//   preview 可多次触发 "importing" 子状态，每批成功后返回 preview
//   当 pendingRecords.length === 0 时，自动跳转至 done

import { useState, useRef, useEffect }  from 'react'
import { useLedger }                    from '@/hooks/useLedger'
import { useAuthStore }                 from '@/store/authStore'
import {
  parseV2JSON, batchImportV2, importV2Evidences,
  importV2EvidencesFromMigrated, deleteV2Records,
} from '@/services/v2ImportService'
import type {
  ParsedV2Record, ImportResult, CleanupResult,
  MigratedMap, V3VoucherObject,
} from '@/services/v2ImportService'
import { createLedger }                 from '@/services/firebase/ledgerService'
import type { LedgerType }              from '@/types/Ledger.types'

// ════════════════════════════════════════════════════════════════
// § 0  sessionStorage 持久化辅助
// ════════════════════════════════════════════════════════════════

const SESSION_KEY = 'rmm_v2_import_queue'
const SESSION_TTL = 24 * 60 * 60 * 1000   // 24 小时

interface SessionState {
  ledgerId:      string
  pendingRecords: ParsedV2Record[]
  importedCount: number
  skipCount:     number
  savedAt:       number
}

function sessionSave(state: Omit<SessionState, 'savedAt'>): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() }))
  } catch { /* storage quota exceeded — ignore */ }
}

function sessionLoad(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as SessionState
    if (!s.savedAt || Date.now() - s.savedAt > SESSION_TTL) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    if (!Array.isArray(s.pendingRecords) || s.pendingRecords.length === 0) return null
    return s
  } catch {
    return null
  }
}

function sessionClear(): void {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

// ════════════════════════════════════════════════════════════════
// § 1  步骤类型
// ════════════════════════════════════════════════════════════════

type ImportStep   = 'select_ledger' | 'input_data' | 'preview' | 'importing' | 'done'
type ImportPhase  = 'text' | 'evidence'
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
              <div className={[
                'flex-1 h-0.5 mx-2',
                isDone ? 'bg-green-300' : 'bg-slate-200',
              ].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 3  内联复用：Spinner
// ════════════════════════════════════════════════════════════════

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════
// § 4  内联复用：进度条
// ════════════════════════════════════════════════════════════════

function ProgressBar({ value, colorClass = 'bg-primary-500' }: { value: number; colorClass?: string }) {
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 5  主组件 Props
// ════════════════════════════════════════════════════════════════

interface V2ImportModalProps {
  isOpen:     boolean
  onClose:    () => void
  showToast?: (msg: string, type?: 'success' | 'warning' | 'error') => void
}

// ════════════════════════════════════════════════════════════════
// § 6  主组件
// ════════════════════════════════════════════════════════════════

export default function V2ImportModal({ isOpen, onClose, showToast }: V2ImportModalProps) {

  // ── Store ────────────────────────────────────────────────────
  const { ledgers, activeLedgerId, switchLedger } = useLedger()
  const user = useAuthStore(s => s.user)

  // ── 步骤 ────────────────────────────────────────────────────
  const [step,           setStep]           = useState<ImportStep>('select_ledger')
  const [targetLedgerId, setTargetLedgerId] = useState<string>('')

  // ── 新建账套 mini-form ────────────────────────────────────────
  const [showNewLedger,     setShowNewLedger]     = useState(false)
  const [newName,           setNewName]           = useState('')
  const [newType,           setNewType]           = useState<LedgerType>('personal')
  const [newCcy,            setNewCcy]            = useState('CNY')
  const [newLedgerCreating, setNewLedgerCreating] = useState(false)

  // ── 数据输入 ──────────────────────────────────────────────────
  const [jsonText,   setJsonText]   = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 待导入队列（核心状态，与 sessionStorage 双向同步）─────────
  const [pendingRecords, setPendingRecords] = useState<ParsedV2Record[]>([])
  const [importedCount,  setImportedCount]  = useState(0)    // 累计成功导入条数
  const [skipCount,      setSkipCount]      = useState(0)    // 原始解析跳过条数

  // ── 复选框选中状态（下标集合，对应 pendingRecords 的索引）──────
  const [selectedSet,  setSelectedSet]  = useState<Set<number>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)

  // ── 当前批次导入进度 ──────────────────────────────────────────
  const [importPhase,     setImportPhase]     = useState<ImportPhase>('text')
  const [importProgress,  setImportProgress]  = useState(0)
  const [lastBatchResult, setLastBatchResult] = useState<ImportResult | null>(null)
  const [lastEvidResult,  setLastEvidResult]  = useState<{ uploaded: number; skipped: number } | null>(null)

  // ── 清场工具 ──────────────────────────────────────────────────
  const [cleanupState,       setCleanupState]       = useState<CleanupState>('idle')
  const [cleanupResult,      setCleanupResult]      = useState<CleanupResult | null>(null)
  const [cleanupProgress,    setCleanupProgress]    = useState(0)
  const [cleanupConfirmText, setCleanupConfirmText] = useState('')

  // ── 断点续传提示 ──────────────────────────────────────────────
  const [resumeState, setResumeState] = useState<SessionState | null>(null)

  // ── 凭证迁移索引 (v3-migrated.json 直写模式) ─────────────────
  const [migratedMap,   setMigratedMap]   = useState<MigratedMap | null>(null)
  const [migratedCount, setMigratedCount] = useState(0)
  const migratedFileInputRef = useRef<HTMLInputElement>(null)

  // ── 通用错误 ──────────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState('')

  // ════════════════════════════════════════════════════════════
  // Effects
  // ════════════════════════════════════════════════════════════

  // 全选 checkbox 的 indeterminate 视觉效果
  useEffect(() => {
    if (!selectAllRef.current) return
    const n = pendingRecords.length
    const s = selectedSet.size
    selectAllRef.current.indeterminate = s > 0 && s < n
  }, [selectedSet.size, pendingRecords.length])

  // 弹窗打开时，检测 sessionStorage 断点续传（仅在初始状态下检测）
  useEffect(() => {
    if (!isOpen) return
    if (step !== 'select_ledger' || pendingRecords.length > 0) return
    const saved = sessionLoad()
    if (saved) {
      console.info('[V2ImportModal] 发现 sessionStorage 断点状态 — 剩余:', saved.pendingRecords.length, '条')
      setResumeState(saved)
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ════════════════════════════════════════════════════════════
  // 辅助函数
  // ════════════════════════════════════════════════════════════

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
    setJsonText('')
    setPendingRecords([]); setImportedCount(0); setSkipCount(0)
    setSelectedSet(new Set())
    setMigratedMap(null); setMigratedCount(0)
    setImportPhase('text'); setImportProgress(0)
    setLastBatchResult(null); setLastEvidResult(null)
    setCleanupState('idle'); setCleanupResult(null); setCleanupProgress(0)
    setResumeState(null)
    clearErr()
    sessionClear()
  }

  function handleClose() {
    if (step === 'importing') return
    onClose()
    // 有待导入队列时：状态已持久化到 session，保留在内存中不重置（支持断点续传）
    // 无待导入队列或已完成时：完整重置
    if (step === 'done' || pendingRecords.length === 0) {
      setTimeout(resetAll, 300)
    }
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose()
  }

  // ════════════════════════════════════════════════════════════
  // 断点续传
  // ════════════════════════════════════════════════════════════

  function handleResume() {
    if (!resumeState) return
    setTargetLedgerId(resumeState.ledgerId)
    setPendingRecords(resumeState.pendingRecords)
    setImportedCount(resumeState.importedCount)
    setSkipCount(resumeState.skipCount)
    setSelectedSet(new Set(resumeState.pendingRecords.map((_, i) => i)))  // 默认全选
    setResumeState(null)
    clearErr()
    setStep('preview')
    console.info('[V2ImportModal] 断点续传 — 恢复', resumeState.pendingRecords.length, '条剩余记录')
  }

  function handleAbandonResume() {
    sessionClear()
    setResumeState(null)
    console.info('[V2ImportModal] 放弃续传，清除 session 状态')
  }

  // ════════════════════════════════════════════════════════════
  // 凭证迁移索引解析（v3-migrated.json → MigratedMap）
  // ════════════════════════════════════════════════════════════

  function handleMigratedFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const json = JSON.parse(String(ev.target?.result ?? ''))
        const txs: Array<{ _legacyRowNum: number; v3VoucherObjects: V3VoucherObject[] }>
          = Array.isArray(json.transactions) ? json.transactions : []
        const map = new Map<number, V3VoucherObject[]>()
        let total = 0
        for (const tx of txs) {
          if (typeof tx._legacyRowNum === 'number' && Array.isArray(tx.v3VoucherObjects)) {
            map.set(tx._legacyRowNum, tx.v3VoucherObjects)
            total += tx.v3VoucherObjects.length
          }
        }
        setMigratedMap(map)
        setMigratedCount(total)
        clearErr()
        console.info(`[V2ImportModal] 凭证索引已载入 — ${map.size} 条记录，${total} 张凭证`)
      } catch {
        showErr('v3-migrated.json 解析失败，请确认文件由迁移脚本生成且格式正确')
      }
    }
    reader.onerror = () => showErr('凭证索引文件读取失败，请重试')
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  // ════════════════════════════════════════════════════════════
  // 步骤一：选择账套
  // ════════════════════════════════════════════════════════════

  function handleLedgerConfirm() {
    if (!targetLedgerId) {
      showErr('请先选择一个目标账套，或点击「新建账套」创建新账套')
      return
    }
    clearErr()
    setStep('input_data')
  }

  async function handleCreateLedger() {
    if (!newName.trim()) { showErr('账套名称不能为空'); return }
    if (!user) { showErr('用户未登录，无法创建账套'); return }
    setNewLedgerCreating(true); clearErr()
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

  // ════════════════════════════════════════════════════════════
  // 步骤二：数据输入与解析
  // ════════════════════════════════════════════════════════════

  // ── v3-final-import 格式检测（stitch-data.ts 输出）─────────
  const [isFinalImport,       setIsFinalImport]       = useState(false)
  const [finalImportStats,    setFinalImportStats]     = useState<{
    total: number; withVouchers: number; totalVouchers: number
  } | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      showErr('请上传 .json 格式的文件'); return
    }
    if (file.size > 50 * 1024 * 1024) {
      showErr('文件过大（上限 50 MB）'); return
    }
    const reader = new FileReader()
    reader.onload = ev => {
      const text = String(ev.target?.result ?? '')
      setJsonText(text)
      clearErr()

      // 检测是否为 v3-final-import 格式，更新 UI 提示
      try {
        const parsed = JSON.parse(text)
        if (parsed && parsed['_format'] === 'v3-final-import') {
          setIsFinalImport(true)
          setFinalImportStats({
            total:         parsed.stats?.totalTransactions ?? 0,
            withVouchers:  parsed.stats?.withVouchers      ?? 0,
            totalVouchers: parsed.stats?.totalVouchers     ?? 0,
          })
          console.info('[V2ImportModal] 检测到 v3-final-import 格式，已自动启用直写凭证通道')
        } else {
          setIsFinalImport(false)
          setFinalImportStats(null)
        }
      } catch { /* 格式检测失败，在 handleParse 时统一报错 */ }

      console.info('[V2ImportModal] 文件读取完成，字符数:', text.length)
    }
    reader.onerror = () => showErr('文件读取失败，请重试')
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  function handleParse() {
    const trimmed = jsonText.trim()
    if (!trimmed) { showErr('请先粘贴或上传数据文件'); return }
    clearErr()

    let result
    try {
      result = parseV2JSON(trimmed)
    } catch (e) {
      showErr(e instanceof Error ? e.message : 'JSON 解析异常，请检查数据格式')
      return
    }

    console.info('[V2ImportModal] 解析完成 — 有效:', result.records.length, '跳过:', result.skipCount, '错误:', result.errors)

    if (result.records.length === 0) {
      const msg = result.errors.length > 0
        ? result.errors.join('；')
        : '没有解析到有效记录（所有记录金额为 0 或格式无效）'
      showErr(msg)
      return
    }

    // 初始化待导入队列
    const pending = result.records
    setPendingRecords(pending)
    setImportedCount(0)
    setSkipCount(result.skipCount)
    setSelectedSet(new Set(pending.map((_, i) => i)))  // 默认全选

    // 持久化到 sessionStorage（防关窗丢失）
    sessionSave({
      ledgerId:      targetLedgerId,
      pendingRecords: pending,
      importedCount: 0,
      skipCount:     result.skipCount,
    })

    setStep('preview')
  }

  // ════════════════════════════════════════════════════════════
  // 步骤三（可循环）：分批导入选中记录
  // ════════════════════════════════════════════════════════════

  async function handleImportSelected() {
    if (!user)           { showErr('用户未登录，请刷新页面后重试'); return }
    if (!targetLedgerId) { showErr('目标账套 ID 为空，请返回第一步重新选择'); return }
    if (selectedSet.size === 0) { showErr('请至少勾选一条记录再导入'); return }

    // 构建本批子集：将选中下标升序排列，提取对应记录
    const sortedOriginalIdxs = [...selectedSet].sort((a, b) => a - b)
    const toImport           = sortedOriginalIdxs.map(i => pendingRecords[i])

    console.info(`[V2ImportModal] 开始本批导入 — ${toImport.length} 条 → 账套: ${targetLedgerId}`)

    setStep('importing')
    setImportPhase('text')
    setImportProgress(0)
    clearErr()

    try {
      // ── 阶段 1：文字批量写入 Firestore ─────────────────────
      const textResult = await batchImportV2(
        toImport,
        targetLedgerId,
        user.uid,
        (done, total) => setImportProgress(total > 0 ? Math.round(done / total * 100) : 100),
      )
      setLastBatchResult(textResult)
      console.info('[V2ImportModal] 文字导入完成 — 成功:', textResult.imported, '失败:', textResult.errors.length)

      // ── 阶段 2：凭证绑定 ─────────────────────────────────────
      // v3-final-import 格式：凭证已在 batchImportV2 内部随 transactions 一并写入，
      // evidences 文档已存在，无需再次处理，直接跳过此阶段
      setImportPhase('evidence')
      setImportProgress(0)

      let evResult: { uploaded: number; skipped: number }

      if (isFinalImport) {
        // 凭证已内嵌写入，统计本批有凭证的数量给 UI 展示
        const embeddedCount = toImport.reduce((s, r) => {
          const v = r._raw['v3Vouchers'] as unknown[] | undefined
          return s + (Array.isArray(v) ? v.length : 0)
        }, 0)
        evResult = { uploaded: embeddedCount, skipped: 0 }
        setImportProgress(100)
      } else if (migratedMap) {
        // 兼容旧路径：手动上传了 v3-migrated.json
        const r = await importV2EvidencesFromMigrated(
          toImport,
          textResult.txDocIds,
          migratedMap,
          targetLedgerId,
          user.uid,
          (done, total) => setImportProgress(total > 0 ? Math.round(done / total * 100) : 100),
        )
        evResult = { uploaded: r.uploaded, skipped: r.skipped }
      } else {
        // 兜底路径：CORS 代理拉取（老 V2 格式 + 无预迁移索引）
        const r = await importV2Evidences(
          toImport,
          textResult.txDocIds,
          targetLedgerId,
          user.uid,
          (done, total) => setImportProgress(total > 0 ? Math.round(done / total * 100) : 100),
        )
        evResult = { uploaded: r.uploaded, skipped: r.skipped }
      }

      setLastEvidResult({ uploaded: evResult.uploaded, skipped: evResult.skipped })
      console.info('[V2ImportModal] 凭证导入完成 — 上传:', evResult.uploaded, '跳过:', evResult.skipped)

      // ── 精准扣减：仅移除成功写入的记录 ─────────────────────
      // textResult.txDocIds[j] 非空 ↔ toImport[j]（即 pendingRecords[sortedOriginalIdxs[j]]）成功
      const successOriginalIdxSet = new Set(
        sortedOriginalIdxs.filter((_, j) => textResult.txDocIds[j] !== ''),
      )
      const newPending        = pendingRecords.filter((_, i) => !successOriginalIdxSet.has(i))
      const importedThisBatch = successOriginalIdxSet.size
      const newImportedCount  = importedCount + importedThisBatch

      setPendingRecords(newPending)
      setImportedCount(newImportedCount)
      setSelectedSet(new Set())  // 清空本批选中，等待用户下次选择

      // ── 持久化队列（或清除 session）──────────────────────────
      if (newPending.length === 0) {
        sessionClear()
      } else {
        sessionSave({
          ledgerId:      targetLedgerId,
          pendingRecords: newPending,
          importedCount: newImportedCount,
          skipCount,
        })
      }

      // ── 导航：全部完成 → done，否则留在 preview 继续 ─────────
      if (newPending.length === 0) {
        // 自动切换 activeLedgerId → targetLedgerId，确保 billStore 监听器重新订阅
        // 这样用户关闭弹窗后，冲突中心能立刻看到刚导入的数据
        if (targetLedgerId && targetLedgerId !== activeLedgerId) {
          switchLedger(targetLedgerId)
          console.info(`[V2ImportModal] 自动切换账套 ${activeLedgerId} → ${targetLedgerId}`)
        }
        setStep('done')
        showToast?.(`🎉 全部导入完成！共成功导入 ${newImportedCount} 条`, 'success')
      } else {
        setStep('preview')
        const failedThisBatch = toImport.length - importedThisBatch
        if (failedThisBatch > 0) {
          showToast?.(
            `本批成功 ${importedThisBatch} 条，${failedThisBatch} 条写入失败，可重新勾选后重试`,
            'warning',
          )
        } else {
          showToast?.(
            `✅ 本批成功导入 ${importedThisBatch} 条，剩余 ${newPending.length} 条待导入`,
            'success',
          )
        }
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : '导入时发生未知错误，请重试'
      console.error('[V2ImportModal] 导入异常:', e)
      showErr(msg)
      setStep('preview')
    }
  }

  // ════════════════════════════════════════════════════════════
  // 清场（精准删除 V2_to_V3 数据）
  // ════════════════════════════════════════════════════════════

  async function handleCleanup() {
    if (!targetLedgerId) { showErr('请先在步骤一选择账套'); return }
    if (!user) { showErr('用户未登录'); return }
    setCleanupState('running'); setCleanupProgress(0); setCleanupResult(null); setCleanupConfirmText(''); clearErr()
    console.info('[V2ImportModal] 开始清场 — 账套:', targetLedgerId)
    try {
      const result = await deleteV2Records(
        targetLedgerId,
        (deleted, total) => setCleanupProgress(total > 0 ? Math.round(deleted / total * 100) : 100),
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
  const targetLedger  = ledgers.find(l => l.id === targetLedgerId)
  const resumeLedger  = resumeState ? ledgers.find(l => l.id === resumeState.ledgerId) : null

  const totalInQueue  = pendingRecords.length
  const selectedCount = selectedSet.size
  const allSelected   = selectedCount === totalInQueue && totalInQueue > 0
  const noneSelected  = selectedCount === 0

  const totalEver     = importedCount + totalInQueue   // 原始解析总数（不含 skip）
  const progressPct   = totalEver > 0 ? Math.round(importedCount / totalEver * 100) : 0

  const queueExpTotal = pendingRecords.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0)
  const queueIncTotal = pendingRecords.filter(r => r.amount >= 0).reduce((s, r) => s + r.amount, 0)

  // 清场工具（复用于步骤一和完成页）
  const cleanupZone = (
    <div className="border border-red-200 rounded-xl overflow-hidden">
      <details className="group">
        <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer
                            bg-red-50 hover:bg-red-100 transition-colors list-none">
          <div className="flex items-center gap-2">
            <span className="text-sm">🗑️</span>
            <span className="text-xs font-semibold text-red-700">危险区：清空已迁移数据</span>
          </div>
          <span className="text-red-400 text-xs group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="px-4 py-3 bg-white space-y-3">
          <p className="text-[11px] text-slate-800 leading-relaxed">
            将删除账套 <strong className="text-red-700">{(targetLedger?.name ?? targetLedgerId) || '（未选择）'}</strong> 下
            所有 <code className="bg-slate-100 px-1 rounded text-slate-800">sourceType=V2_to_V3</code> 的账单及凭证。
            <strong className="text-slate-900"> 原生 V3 数据不受影响。</strong>
          </p>
          {/* ⚠️ 不可逆警告 */}
          <p className="text-[11px] text-red-600 font-semibold leading-relaxed bg-red-50
                         border border-red-200 rounded-lg px-3 py-2">
            ⚠️ 此操作将彻底销毁关联的 Firebase Storage 凭证照片！<br />
            照片一经删除无法自动恢复，需重新运行迁移脚本才能还原。<br />
            <strong>请务必确认你不再需要这些数据后再操作。</strong>
          </p>
          {!targetLedgerId && (
            <p className="text-[11px] text-amber-700">⚠️ 请先在上方选择一个账套</p>
          )}
          {cleanupState === 'idle' || cleanupState === 'error' ? (
            <div className="space-y-2">
              <input
                type="text"
                value={cleanupConfirmText}
                onChange={e => setCleanupConfirmText(e.target.value)}
                placeholder='请输入"确认销毁"解锁删除按钮'
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-red-400
                           placeholder:text-slate-400 text-slate-800"
              />
              <button
                onClick={() => { void handleCleanup() }}
                disabled={!targetLedgerId || cleanupConfirmText !== '确认销毁'}
                className="w-full py-2 rounded-lg text-xs font-bold bg-red-600 text-white
                           hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🗑️ 确认清空已迁移数据
              </button>
            </div>
          ) : cleanupState === 'running' ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Spinner className="w-3.5 h-3.5 text-red-500" />
                <span className="text-xs text-red-700">清场中… {cleanupProgress}%</span>
              </div>
              <ProgressBar value={cleanupProgress} colorClass="bg-red-500" />
            </div>
          ) : cleanupState === 'done' && cleanupResult ? (
            <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-xs text-green-800">
                ✅ 清场完成：删除账单 <strong>{cleanupResult.deleted}</strong> 条，
                凭证 <strong>{cleanupResult.evidencesCleaned}</strong> 张
              </p>
              <button
                onClick={() => { setCleanupState('idle'); setCleanupResult(null) }}
                className="mt-1.5 text-[11px] text-slate-600 hover:text-slate-800 underline"
              >
                重置清场状态
              </button>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )

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
            <p className="text-[11px] text-slate-600 mt-0.5">
              将旧版账单迁移至 V3 账套，自动进入冲突验证队列
            </p>
          </div>
          {step !== 'importing' && (
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-full
                         text-slate-500 hover:text-slate-800
                         hover:bg-slate-100 transition-colors text-lg leading-none"
            >×</button>
          )}
        </div>

        {/* 步骤进度条 */}
        <StepBar current={step} />

        {/* 通用错误提示 */}
        {errorMsg && (
          <div className="mx-5 mt-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl
                          flex items-start gap-2 flex-shrink-0">
            <span className="text-sm flex-shrink-0 mt-0.5">⚠️</span>
            <p className="text-xs text-red-700 leading-snug">{errorMsg}</p>
          </div>
        )}

        {/* ── 主体内容（可滚动）─────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ══════════ 步骤一：选择账套 ══════════ */}
          {step === 'select_ledger' && !showNewLedger && (
            <div className="px-5 py-4 space-y-4">

              {/* 断点续传横幅 */}
              {resumeState && (
                <div className="px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-base flex-shrink-0">🔄</span>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-amber-900">发现未完成的导入任务</p>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        账套：<strong>{resumeLedger?.name ?? resumeState.ledgerId}</strong>
                        {' '}· 剩余 <strong>{resumeState.pendingRecords.length}</strong> 条
                        · 已导入 <strong>{resumeState.importedCount}</strong> 条
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleResume}
                      disabled={!resumeLedger}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold
                                 bg-amber-600 text-white hover:bg-amber-700
                                 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      立即续传
                    </button>
                    <button
                      onClick={handleAbandonResume}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium
                                 bg-white border border-amber-300 text-amber-800
                                 hover:bg-amber-50 transition-colors"
                    >
                      放弃，重新导入
                    </button>
                  </div>
                  {!resumeLedger && (
                    <p className="text-[10px] text-red-600">⚠️ 原账套已不可用，建议放弃此任务</p>
                  )}
                </div>
              )}

              {/* 导入须知 */}
              <div className="px-3 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-xs text-blue-800 font-medium leading-relaxed">📋 导入须知</p>
                <ul className="mt-1.5 space-y-1 text-xs text-blue-700 leading-relaxed">
                  <li>· 所有记录打上 <code className="bg-blue-100 px-1 rounded text-blue-900">V2_to_V3</code> 来源标记，进入「待验证」队列</li>
                  <li>· V2 旧字段封存于 <code className="bg-blue-100 px-1 rounded text-blue-900">legacy_backup</code>，不污染 V3 统计</li>
                  <li>· 可分批勾选导入，随时关闭，下次打开自动续传</li>
                </ul>
              </div>

              {/* 账套列表 */}
              <div>
                <p className="text-xs font-semibold text-slate-800 mb-2">
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
                          : 'bg-slate-100 text-slate-700',
                      ].join(' ')}>
                        {ledger.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{ledger.name}</p>
                        <p className="text-[11px] text-slate-600">{ledger.currency} · {ledger.type}</p>
                      </div>
                      {targetLedgerId === ledger.id && (
                        <span className="text-primary-500 text-lg flex-shrink-0">✓</span>
                      )}
                    </button>
                  ))}

                  {ledgers.length === 0 && (
                    <div className="py-4 text-center">
                      <p className="text-sm text-slate-600">暂无可用账套</p>
                      <p className="text-xs text-slate-500 mt-1">请点击下方「+ 新建账套」</p>
                    </div>
                  )}

                  <button
                    onClick={() => { setShowNewLedger(true); clearErr() }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                               border-2 border-dashed border-primary-300 bg-transparent
                               text-primary-700 hover:bg-primary-50 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center
                                    justify-center text-base font-bold flex-shrink-0">+</div>
                    <span className="text-sm font-medium">新建账套</span>
                  </button>
                </div>
              </div>

              {/* 危险区：清场工具 */}
              {cleanupZone}

            </div>
          )}

          {/* ══════════ 步骤一：新建账套 mini-form ══════════ */}
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
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">
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
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">账套类型</label>
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
                          : 'border-slate-200 bg-slate-100 text-slate-700 hover:border-primary-300',
                      ].join(' ')}
                    >{label}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">货币</label>
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

          {/* ══════════ 步骤二：输入数据 ══════════ */}
          {step === 'input_data' && (
            <div className="px-5 py-4 space-y-4">

              {/* 目标账套确认条 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100
                              rounded-xl border border-slate-200">
                <span className="text-base">🗂️</span>
                <p className="text-xs text-slate-700">
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

              {/* JSON 格式说明（折叠）*/}
              <details className="group">
                <summary className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer
                                    hover:text-slate-900 list-none select-none">
                  <span className="group-open:rotate-90 transition-transform text-slate-400">▶</span>
                  查看 V2 JSON 格式说明
                </summary>
                <div className="mt-2 px-3 py-3 bg-slate-100 rounded-xl">
                  <p className="text-[11px] text-slate-700 mb-2">接受以下任意格式：</p>
                  <pre className="text-[10px] text-slate-800 leading-relaxed overflow-x-auto">{`// 格式 1：JSON 数组
[
  { "date": "2024-01-15", "amount": -38.5,
    "category": "餐饮", "memo": "午饭" },
  { "tradeTime": "2024-01", "money": 5000,
    "type": "收入", "remark": "工资" }
]

// 格式 2：带外层包装
{ "data": [ ... ] }
{ "records": [ ... ] }
{ "transactions": [ ... ] }`}</pre>
                </div>
              </details>

              {/* 文件上传 */}
              <div>
                <p className="text-xs font-semibold text-slate-800 mb-2">上传 JSON 文件</p>
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
                    <p className="text-sm text-slate-800 font-medium">点击选择 JSON 文件</p>
                    <p className="text-[11px] text-slate-500">支持 Firebase 导出格式 · 上限 10 MB</p>
                  </div>
                </button>
                {jsonText.length > 0 && (
                  <p className="text-[11px] text-green-700 mt-1 px-1">
                    ✓ 已载入 {jsonText.length.toLocaleString()} 字符
                  </p>
                )}

                {/* 格式识别结果卡片 */}
                {isFinalImport && finalImportStats && (
                  <div className="mt-2 px-3 py-2.5 bg-emerald-50 border border-emerald-300
                                  rounded-xl space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">🎯</span>
                      <p className="text-xs font-bold text-emerald-800">
                        检测到 v3-final-import 万能格式
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      <div className="text-center">
                        <p className="text-base font-bold text-emerald-700">
                          {finalImportStats.total}
                        </p>
                        <p className="text-[10px] text-emerald-600">条账单</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-bold text-emerald-700">
                          {finalImportStats.withVouchers}
                        </p>
                        <p className="text-[10px] text-emerald-600">条带照片</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-bold text-emerald-700">
                          {finalImportStats.totalVouchers}
                        </p>
                        <p className="text-[10px] text-emerald-600">张凭证</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-emerald-700 pt-0.5">
                      ✅ 凭证已内嵌，导入时直接写入 Firestore，无需下载 · 无需额外上传
                    </p>
                  </div>
                )}
              </div>

              {/* 粘贴 JSON */}
              <div>
                <p className="text-xs font-semibold text-slate-800 mb-2">粘贴 JSON 数据</p>
                <textarea
                  value={jsonText}
                  onChange={e => { setJsonText(e.target.value); clearErr() }}
                  placeholder={`粘贴 V2 导出的 JSON 数组，例如：\n[\n  { "date": "2024-01-01", "amount": -38.5, "category": "餐饮", "memo": "午饭" },\n  ...\n]`}
                  rows={7}
                  className="w-full px-4 py-3 bg-slate-100 rounded-xl text-xs
                             text-slate-900 font-mono
                             border-2 border-transparent focus:border-primary-300
                             focus:bg-white outline-none resize-none
                             placeholder:text-slate-400 transition-all"
                />
              </div>

              {/* 凭证迁移索引（可选）——直写模式，跳过 CORS 下载 */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📷</span>
                    <p className="text-xs font-semibold text-slate-800">凭证迁移索引</p>
                    <span className="text-[10px] text-slate-400">可选 · 凭证直写模式</span>
                  </div>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    上传 <code className="bg-slate-100 text-slate-700 px-1 rounded text-[10px]">v3-migrated.json</code>（由迁移脚本生成），凭证将从 Firebase Storage 直接绑定，无需重新下载
                  </p>
                  <input
                    ref={migratedFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleMigratedFileChange}
                    className="hidden"
                  />
                  {migratedMap ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-green-50
                                    border border-green-200 rounded-lg">
                      <span className="text-sm flex-shrink-0">✅</span>
                      <p className="text-xs font-medium text-green-800 flex-1">
                        已载入 · <strong className="text-green-900">{migratedCount}</strong> 张凭证就绪
                      </p>
                      <button
                        onClick={() => { setMigratedMap(null); setMigratedCount(0) }}
                        className="text-[11px] text-slate-500 hover:text-slate-700 underline flex-shrink-0"
                      >
                        移除
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => migratedFileInputRef.current?.click()}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                                 border-2 border-dashed border-slate-200
                                 hover:border-green-400 hover:bg-green-50/50
                                 transition-all text-left"
                    >
                      <span className="text-xl">🗄️</span>
                      <div>
                        <p className="text-sm text-slate-700 font-medium">选择 v3-migrated.json</p>
                        <p className="text-[11px] text-slate-500">
                          由 migrate-drive-to-firebase.ts 脚本生成
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ══════════ 步骤三（可循环）：预览 + 复选框导入 ══════════ */}
          {step === 'preview' && pendingRecords.length > 0 && (
            <div className="px-5 py-4 space-y-3">

              {/* 进度统计横幅 */}
              <div className="px-4 py-3 bg-slate-800 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-center">
                    <p className="text-[10px] text-slate-400">已成功导入</p>
                    <p className="text-xl font-bold text-green-400 tabular-nums leading-tight">
                      {importedCount}
                    </p>
                    <p className="text-[10px] text-slate-400">条</p>
                  </div>
                  <div className="flex-1 px-4">
                    <ProgressBar value={progressPct} colorClass="bg-green-400" />
                    <p className="text-center text-[10px] text-slate-400 mt-1">
                      {progressPct}% 完成
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-slate-400">剩余待导入</p>
                    <p className="text-xl font-bold text-amber-400 tabular-nums leading-tight">
                      {totalInQueue}
                    </p>
                    <p className="text-[10px] text-slate-400">条</p>
                  </div>
                </div>
                {skipCount > 0 && (
                  <p className="text-[10px] text-slate-500 text-center">
                    另有 {skipCount} 条因金额为 0 已跳过
                  </p>
                )}
              </div>

              {/* 目标账套标签 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl">
                <span className="text-base">🗂️</span>
                <p className="text-xs text-slate-700">
                  导入至：<strong className="text-slate-900">{targetLedger?.name ?? targetLedgerId}</strong>
                </p>
              </div>

              {/* 全选工具栏 */}
              <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-100 rounded-xl border border-slate-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={e => {
                      setSelectedSet(
                        e.target.checked
                          ? new Set(pendingRecords.map((_, i) => i))
                          : new Set(),
                      )
                    }}
                    className="w-4 h-4 accent-primary-600 cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-slate-800 select-none">
                    {allSelected
                      ? `已全选（${totalInQueue} 条）`
                      : noneSelected
                      ? `全选（${totalInQueue} 条）`
                      : `已选 ${selectedCount} / ${totalInQueue} 条`}
                  </span>
                </label>
                <div className="flex-1" />
                {selectedCount > 0 && (
                  <span className="text-[11px] font-medium text-slate-700 bg-primary-100
                                   px-2 py-0.5 rounded-full tabular-nums">
                    选中 {selectedCount} 条
                  </span>
                )}
              </div>

              {/* 记录列表（可滚动）*/}
              <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5
                              scrollbar-thin scrollbar-thumb-slate-200">
                {pendingRecords.map((record, idx) => (
                  <label
                    key={idx}
                    className={[
                      'flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors',
                      selectedSet.has(idx)
                        ? 'bg-primary-50 border border-primary-200'
                        : 'bg-slate-50 border border-transparent hover:border-slate-200 hover:bg-white',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(idx)}
                      onChange={e => {
                        const next = new Set(selectedSet)
                        if (e.target.checked) next.add(idx)
                        else next.delete(idx)
                        setSelectedSet(next)
                      }}
                      className="w-4 h-4 accent-primary-600 flex-shrink-0 cursor-pointer"
                    />
                    <span className="text-[11px] text-slate-600 w-[68px] flex-shrink-0 tabular-nums">
                      {record.date}
                    </span>
                    <span className={[
                      'text-xs font-bold tabular-nums w-[76px] text-right flex-shrink-0',
                      record.amount < 0 ? 'text-red-600' : 'text-green-700',
                    ].join(' ')}>
                      {record.amount < 0 ? '-' : '+'}¥{Math.abs(record.amount).toFixed(2)}
                    </span>
                    <span className="text-[11px] text-slate-600 w-12 flex-shrink-0 truncate">
                      {record.category}
                    </span>
                    <span className="text-[11px] text-slate-800 truncate flex-1 min-w-0">
                      {record.description || '—'}
                    </span>
                  </label>
                ))}
              </div>

              {/* 队列金额小计 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="px-3 py-2 bg-red-50 rounded-xl text-center">
                  <p className="text-[10px] text-red-600">队列支出合计</p>
                  <p className="text-sm font-bold text-red-700 tabular-nums">
                    -¥{queueExpTotal.toFixed(2)}
                  </p>
                </div>
                <div className="px-3 py-2 bg-green-50 rounded-xl text-center">
                  <p className="text-[10px] text-green-700">队列收入合计</p>
                  <p className="text-sm font-bold text-green-700 tabular-nums">
                    +¥{queueIncTotal.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* 策略说明 */}
              <div className="px-3 py-2.5 bg-primary-50 border border-primary-200 rounded-xl">
                <p className="text-[11px] text-primary-800 leading-relaxed">
                  ⚡ 导入完成后自动进入【冲突中心 → 待验证】队列。
                  V2 原始字段封装至 <code className="bg-primary-100 px-0.5 rounded text-primary-900">legacy_backup</code>，不影响 V3 统计。
                </p>
              </div>

            </div>
          )}

          {/* ══════════ 导入进行中 ══════════ */}
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
                <p className="text-sm font-semibold text-slate-900">
                  {importPhase === 'evidence' ? '正在迁移凭证图片…' : '正在批量写入云端…'}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  本批 {selectedCount} 条记录，请勿关闭弹窗
                </p>
              </div>
              <div className="w-full max-w-xs space-y-1">
                <ProgressBar value={importProgress} />
                <p className="text-center text-[11px] text-slate-600 tabular-nums">
                  {importProgress}%
                </p>
              </div>
              {importPhase === 'evidence' && (
                <p className="text-[11px] text-slate-500">
                  {migratedMap
                    ? '文字已入库，正在直写凭证索引（无需下载）…'
                    : '文字账单已入库，正在迁移图片凭证…'}
                </p>
              )}
            </div>
          )}

          {/* ══════════ 完成 ══════════ */}
          {step === 'done' && (
            <div className="px-5 py-6 space-y-4">
              <div className="text-center">
                <span className="text-5xl block mb-3">
                  {lastBatchResult && lastBatchResult.errors.length === 0 ? '🎉' : '⚠️'}
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {lastBatchResult && lastBatchResult.errors.length === 0 ? '全部导入完成！' : '导入已完成（含部分失败）'}
                </h3>
                <p className="text-sm text-slate-800 mt-1">
                  本次共成功导入{' '}
                  <strong className="text-primary-600">{importedCount}</strong>{' '}
                  条历史记录
                </p>
                {lastEvidResult && lastEvidResult.uploaded > 0 && (
                  <p className="text-xs text-slate-600 mt-1">
                    凭证图片：上传 {lastEvidResult.uploaded} 张
                    {lastEvidResult.skipped > 0 && `，跳过 ${lastEvidResult.skipped} 张`}
                  </p>
                )}
              </div>

              <div className="px-4 py-3 bg-primary-50 border border-primary-200 rounded-xl">
                <p className="text-xs text-primary-800 leading-relaxed">
                  🛡️ 所有导入记录已进入【冲突中心 → 待验证】队列，请前往审核并逐一确认。
                </p>
              </div>

              {lastBatchResult && lastBatchResult.errors.length > 0 && (
                <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl space-y-1">
                  <p className="text-xs font-semibold text-red-700">最后一批失败记录（前 5 条）：</p>
                  {lastBatchResult.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-[11px] text-red-600 leading-snug">{e}</p>
                  ))}
                  {lastBatchResult.errors.length > 5 && (
                    <p className="text-[11px] text-red-500">…还有 {lastBatchResult.errors.length - 5} 条</p>
                  )}
                </div>
              )}

              {/* 完成页也保留清场工具（便于测试重跑）*/}
              {cleanupZone}

            </div>
          )}

        </div>
        {/* 主体内容结束 */}

        {/* ══ 底部操作栏 ══════════════════════════════════════════ */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-5
                        border-t border-slate-200 flex-shrink-0">

          {/* 取消 / 关闭（导入进行中时隐藏）*/}
          {step !== 'importing' && (
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium
                         bg-slate-100 text-slate-700
                         hover:bg-slate-200 transition-colors"
            >
              {step === 'done' ? '关闭' : '取消'}
            </button>
          )}

          {/* 步骤一 — 新建账套表单 */}
          {step === 'select_ledger' && showNewLedger && (
            <button
              onClick={() => { void handleCreateLedger() }}
              disabled={!newName.trim() || newLedgerCreating}
              className="flex-[2] py-2.5 rounded-xl text-sm font-bold
                         bg-primary-600 text-white hover:bg-primary-700
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {newLedgerCreating ? (<><Spinner /><span>创建中…</span></>) : '✨ 创建并继续'}
            </button>
          )}

          {/* 步骤一 — 下一步 */}
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

          {/* 步骤二 — 解析数据 */}
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

          {/* 步骤三 — 动态显示已选数量的导入按钮 */}
          {step === 'preview' && (
            <>
              {/* 如果已导入过部分，提供"完成导入"按钮 */}
              {importedCount > 0 && (
                <button
                  onClick={() => {
                    sessionClear()
                    setStep('done')
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium
                             bg-slate-200 text-slate-800
                             hover:bg-slate-300 transition-colors"
                >
                  结束导入
                </button>
              )}
              <button
                onClick={() => { void handleImportSelected() }}
                disabled={noneSelected}
                className={[
                  'py-2.5 rounded-xl text-sm font-bold transition-colors',
                  'flex items-center justify-center gap-2',
                  'bg-green-600 text-white hover:bg-green-700',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  importedCount > 0 ? 'flex-[2]' : 'flex-[2]',
                ].join(' ')}
              >
                <span>📦</span>
                <span>
                  {noneSelected
                    ? '请勾选记录'
                    : `确认导入已选的 ${selectedCount} 条`}
                </span>
              </button>
            </>
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
