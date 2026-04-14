// UnbindingModal — 凭证解绑确认弹窗 (S21 增强版)
//
// 挂载位置：App.tsx > MainApp（全局单例）
// 触发方：EvidenceList / ImageGalleryModal / OmniInputModal 的"解绑"按钮
//         → openUnbindModal(target) → governanceStore.unbindTarget 非 null
//
// 功能：
//   · 软解绑（默认）：凭证移入凭证池（orphan），保留文件，可找回
//   · 硬删除（可选）：点击红色【🗑️ 彻底删除】→ 二次警告 → 物理销毁
//
// 反馈：
//   · 成功后内部显示绿色/红色结果条 800ms，然后关闭
//   · 若调用方传入 target.onSuccess 回调，成功后同步触发（用于外部 Toast）
//
// 防呆：
//   · 2 秒强制倒计时，期间确认按钮锁定
//   · 最后一张凭证额外警告（isVerified 回退提示）
//   · 处理中禁用所有交互

import { useState, useEffect }               from 'react'
import { getDocs, query, collection, where, getDoc, doc } from 'firebase/firestore'
import { db }                                from '@/config/firebase'
import { useGovernanceStore }                from '@/store/governanceStore'
import { useAuthStore }                      from '@/store/authStore'
import { unbindEvidence }                    from '@/services/firebase/governanceService'
import { hardDeleteEvidence }                from '@/services/firebase/evidenceService'

// ── 防呆倒计时时长（秒）────────────────────────────────────────
const COUNTDOWN_SEC = 2

// ════════════════════════════════════════════════════════════════
// § 1  倒计时进度环
// ════════════════════════════════════════════════════════════════

interface CountdownRingProps {
  current: number
  total:   number
  size?:   number
}

function CountdownRing({ current, total, size = 36 }: CountdownRingProps) {
  const radius       = (size - 4) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset   = circumference * (current / total)

  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="#fde68a" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="#f59e0b" strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 1s linear' }}
      />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════
// § 2  二次确认弹层（彻底删除专用）
// ════════════════════════════════════════════════════════════════

interface HardDeleteConfirmProps {
  onConfirm: () => void
  onCancel:  () => void
  isDeleting: boolean
}

function HardDeleteConfirmLayer({ onConfirm, onCancel, isDeleting }: HardDeleteConfirmProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl
                 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.65)' }}
    >
      <div className="mx-4 w-full max-w-[280px] rounded-2xl overflow-hidden shadow-2xl"
           style={{ background: '#fff' }}>
        {/* 顶部红色色带 */}
        <div style={{ height: 4, background: 'linear-gradient(90deg,#ef4444,#dc2626)' }} />
        <div className="px-5 pt-4 pb-2 text-center">
          <div className="text-3xl mb-2">🗑️</div>
          <p className="text-sm font-bold" style={{ color: '#dc2626' }}>
            确认彻底删除？
          </p>
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: '#6b7280' }}>
            此操作将从云端<strong>永久抹除</strong>文件，<br />
            <strong style={{ color: '#dc2626' }}>不可撤销，无法找回！</strong>
          </p>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ background: '#f1f5f9', color: '#475569' }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-colors
                       flex items-center justify-center gap-1.5"
            style={{ background: '#dc2626', color: '#fff', opacity: isDeleting ? 0.6 : 1 }}
          >
            {isDeleting
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white
                                   rounded-full animate-spin" /><span>删除中…</span></>
              : '永久删除'
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// § 3  主组件
// ════════════════════════════════════════════════════════════════

type DoneState = 'unbound' | 'deleted' | null

export default function UnbindingModal() {
  const unbindTarget     = useGovernanceStore(s => s.unbindTarget)
  const closeUnbindModal = useGovernanceStore(s => s.closeUnbindModal)
  const user             = useAuthStore(s => s.user)

  const [countdown,          setCountdown]         = useState(COUNTDOWN_SEC)
  const [isProcessing,       setIsProcessing]      = useState(false)
  const [errorMsg,           setErrorMsg]          = useState<string | null>(null)
  const [isLastEvidence,     setIsLastEvidence]    = useState<boolean | null>(null)
  /** 操作完成后短暂显示结果条，然后自动关闭 */
  const [doneState,          setDoneState]         = useState<DoneState>(null)
  /** 控制硬删二次确认层的显隐 */
  const [showHardConfirm,    setShowHardConfirm]   = useState(false)
  const [isHardDeleting,     setIsHardDeleting]    = useState(false)

  // ── 每次目标变更：重置状态 + 启动倒计时 + 查凭证数 ───────────
  useEffect(() => {
    if (!unbindTarget) return
    setCountdown(COUNTDOWN_SEC)
    setIsProcessing(false)
    setErrorMsg(null)
    setIsLastEvidence(null)
    setDoneState(null)
    setShowHardConfirm(false)
    setIsHardDeleting(false)

    const timerId = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timerId); return 0 }
        return prev - 1
      })
    }, 1000)

    getDocs(query(
      collection(db, 'evidences'),
      where('transactionId', '==', unbindTarget.transactionId),
    ))
      .then(snap => setIsLastEvidence(snap.size === 1))
      .catch(() => setIsLastEvidence(null))

    return () => clearInterval(timerId)
  }, [unbindTarget?.evidenceId])

  if (!unbindTarget) return null

  // ── 关闭（处理中时拦截）────────────────────────────────────────
  function handleClose(): void {
    if (isProcessing || isHardDeleting) return
    closeUnbindModal()
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) handleClose()
  }

  // ── 软解绑确认 ─────────────────────────────────────────────────
  async function handleConfirm(): Promise<void> {
    if (!user || countdown > 0 || isProcessing) return
    setIsProcessing(true)
    setErrorMsg(null)
    try {
      await unbindEvidence(unbindTarget.evidenceId, unbindTarget.transactionId, user.uid)
      setDoneState('unbound')
      // 成功回调（外部 Toast 等）
      unbindTarget.onSuccess?.('unbound')
      // 800ms 后自动关闭
      setTimeout(() => closeUnbindModal(), 800)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '解绑失败，请检查网络后重试')
      setIsProcessing(false)
    }
  }

  // ── 硬删除执行（二次确认后）────────────────────────────────────
  async function handleHardDelete(): Promise<void> {
    if (!user) return
    setIsHardDeleting(true)
    setErrorMsg(null)
    try {
      // 从 Firestore 读取 storagePath（调用方没有传入）
      const evSnap = await getDoc(doc(db, 'evidences', unbindTarget.evidenceId))
      if (!evSnap.exists()) throw new Error('凭证文档不存在，可能已被删除')
      const storagePath = String(evSnap.data()?.['storagePath'] ?? '')
      if (!storagePath) throw new Error('无法获取存储路径，请联系管理员')

      await hardDeleteEvidence(unbindTarget.evidenceId, storagePath)
      setDoneState('deleted')
      unbindTarget.onSuccess?.('deleted')
      setTimeout(() => closeUnbindModal(), 900)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '删除失败，请重试')
      setIsHardDeleting(false)
      setShowHardConfirm(false)
    }
  }

  const canConfirm = countdown === 0 && !isProcessing && !doneState

  // ════════════════════════════════════════════════════════════════
  // § 4  渲染
  // ════════════════════════════════════════════════════════════════

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center
                 bg-black/60 backdrop-blur-sm px-4"
      onClick={handleBackdropClick}
    >
      {/* 弹窗容器 — position:relative 供二次确认层绝对定位 */}
      <div className="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
           style={{ background: 'var(--color-surface-primary, #fff)' }}
           onClick={e => e.stopPropagation()}>

        {/* ── 顶部色带 ── */}
        <div className="h-1 w-full"
             style={{ background: 'linear-gradient(90deg,#f59e0b,#fb923c,#f59e0b)' }} />

        {/* ══ 成功态覆盖（操作完成后短暂显示）══ */}
        {doneState && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl"
               style={{ background: doneState === 'unbound' ? '#d1fae5' : '#fee2e2' }}>
            <span className="text-4xl">{doneState === 'unbound' ? '✅' : '🗑️'}</span>
            <p className="text-sm font-bold"
               style={{ color: doneState === 'unbound' ? '#065f46' : '#991b1b' }}>
              {doneState === 'unbound' ? '凭证已解绑并移入凭证池' : '凭证已彻底删除'}
            </p>
          </div>
        )}

        {/* ── 头部 ── */}
        <div className="flex items-start justify-between px-5 pt-5 pb-1">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none flex-shrink-0 mt-0.5">⚠️</span>
            <div>
              <h2 className="text-base font-bold text-content-primary">确认解绑凭证？</h2>
              <p className="text-[11px] text-content-tertiary mt-0.5">
                凭证将保留至凭证池，可在治理中心找回
              </p>
            </div>
          </div>
          {!isProcessing && !isHardDeleting && !doneState && (
            <button
              type="button"
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 -mt-0.5
                         text-content-tertiary hover:text-content-primary
                         hover:bg-surface-secondary transition-colors text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* ── 内容区 ── */}
        <div className="px-5 py-4 space-y-3">

          {/* 凭证预览 */}
          {unbindTarget.evidenceUrl ? (
            <div className="flex items-center gap-3 px-3 py-2.5
                            bg-surface-secondary rounded-xl border border-border-primary">
              <img
                src={unbindTarget.evidenceUrl}
                alt="凭证预览"
                className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-border-primary"
                onError={e => {
                  (e.currentTarget as HTMLImageElement).replaceWith(
                    Object.assign(document.createElement('div'), {
                      className: 'w-14 h-14 rounded-lg bg-surface-tertiary flex items-center justify-center text-2xl flex-shrink-0',
                      textContent: '📎',
                    })
                  )
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-content-tertiary">凭证预览</p>
                <p className="text-[10px] font-mono text-content-secondary truncate mt-0.5">
                  {unbindTarget.evidenceId}
                </p>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2.5 bg-surface-secondary rounded-xl border border-border-primary">
              <p className="text-[11px] text-content-tertiary">凭证 ID</p>
              <p className="text-xs font-mono text-content-secondary mt-0.5 break-all">
                {unbindTarget.evidenceId}
              </p>
            </div>
          )}

          {/* 软解绑说明（琥珀色区块）*/}
          <div className="px-3 py-3 rounded-xl space-y-2"
               style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
            <p className="text-xs leading-relaxed" style={{ color: '#92400e' }}>
              💔 凭证将从该账单<strong>解除关联</strong>，以 <strong>orphan</strong> 状态保留在凭证池。
              文件不删除，可在「治理中心 → 凭证管理」找回或重新挂载。
            </p>
            {isLastEvidence === true && (
              <div className="pt-2" style={{ borderTop: '1px solid #fde68a' }}>
                <p className="text-xs font-semibold" style={{ color: '#c05621' }}>
                  ⚡ 这是该账单的<strong>最后一张凭证</strong>。解绑后账单核实状态将回退为「未核实」。
                </p>
              </div>
            )}
          </div>

          {/* 硬删除入口（红色次要按钮）*/}
          {!isProcessing && !doneState && (
            <button
              type="button"
              onClick={() => setShowHardConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl
                         text-xs font-semibold transition-all"
              style={{
                background: '#fff1f2',
                border: '1.5px solid #fecdd3',
                color: '#be123c',
              }}
            >
              <span>🗑️</span>
              <span>彻底删除（永久抹除，不可撤销）</span>
            </button>
          )}

          {/* 错误提示 */}
          {errorMsg && (
            <div className="px-3 py-2.5 rounded-xl flex items-start gap-2"
                 style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
              <span className="text-sm flex-shrink-0 mt-0.5">🔴</span>
              <p className="text-xs leading-snug" style={{ color: '#be123c' }}>{errorMsg}</p>
            </div>
          )}
        </div>

        {/* ── 底部操作区（软解绑）── */}
        {!doneState && (
          <div className="flex items-center gap-2 px-5 pb-5">

            {/* 取消 */}
            <button
              type="button"
              onClick={handleClose}
              disabled={isProcessing || isHardDeleting}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#f1f5f9', color: '#475569' }}
            >
              取消
            </button>

            {/* 确认解绑（含倒计时防呆）*/}
            <button
              type="button"
              onClick={() => { void handleConfirm() }}
              disabled={!canConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold
                         flex items-center justify-center gap-2 transition-all duration-300"
              style={canConfirm
                ? { background: '#f59e0b', color: '#fff', cursor: 'pointer' }
                : { background: '#fef3c7', color: '#d97706', cursor: 'not-allowed' }
              }
            >
              {isProcessing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white
                                   rounded-full animate-spin" />
                  <span>解绑中…</span>
                </>
              ) : countdown > 0 ? (
                <>
                  <CountdownRing current={countdown} total={COUNTDOWN_SEC} size={20} />
                  <span>{countdown} 秒后可操作</span>
                </>
              ) : (
                <>
                  <span className="text-base leading-none">💔</span>
                  <span>确认解绑（保留至凭证池）</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ── 二次确认层（彻底删除）── */}
        {showHardConfirm && (
          <HardDeleteConfirmLayer
            onConfirm={() => { void handleHardDelete() }}
            onCancel={() => { if (!isHardDeleting) setShowHardConfirm(false) }}
            isDeleting={isHardDeleting}
          />
        )}
      </div>
    </div>
  )
}
