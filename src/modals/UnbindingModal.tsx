// UnbindingModal — 凭证解绑确认弹窗 (S21)
//
// 挂载位置：App.tsx > MainApp（全局单例，与 EvidenceUploaderModal / EjectionBlocker 同级）
// 触发方：EvidenceList 缩略图右上角"×"→ openUnbindModal() → governanceStore.unbindTarget 非 null
//
// 防呆设计：
//   · 2 秒强制倒计时，期间确认按钮显示锁定态，无法点击
//   · 打开时立即查询该账单剩余凭证数，若为最后一张则显示额外警告
//   · 解绑过程中禁用所有交互，防止重复点击
//   · 背景蒙层 / 关闭按钮：处理中时均不响应
//
// 业务逻辑委托 governanceService.unbindEvidence：
//   1. 删除 Storage 文件 + Firestore evidences 文档
//   2. 查询剩余凭证数，若为 0 → isVerified 回退为 false（历史回改规则）
//   3. 写入 transactionVersions 审计记录

import { useState, useEffect }          from 'react'
import { getDocs, query, collection, where } from 'firebase/firestore'
import { db }                           from '@/config/firebase'
import { useGovernanceStore }           from '@/store/governanceStore'
import { useAuthStore }                 from '@/store/authStore'
import { unbindEvidence }               from '@/services/firebase/governanceService'

// ── 防呆倒计时时长（秒）────────────────────────────────────────
const COUNTDOWN_SEC = 2

// ════════════════════════════════════════════════════════════════
// § 1  倒计时进度环（纯 SVG，无第三方库）
// ════════════════════════════════════════════════════════════════

interface CountdownRingProps {
  current: number   // 剩余秒数（0 = 完成）
  total:   number   // 总秒数
  size?:   number   // SVG 尺寸 px（默认 36）
}

function CountdownRing({ current, total, size = 36 }: CountdownRingProps) {
  const radius      = (size - 4) / 2          // 留 2px stroke 外边距
  const circumference = 2 * Math.PI * radius
  // 进度：0 秒剩余时 strokeDashoffset = 0（满圈），total 秒时 = circumference（空圈）
  const progress    = current / total
  const dashOffset  = circumference * progress

  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      {/* 底圈（轨道）*/}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        className="text-red-200"
      />
      {/* 进度圈 */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className="text-red-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════
// § 2  主组件
// ════════════════════════════════════════════════════════════════

export default function UnbindingModal() {
  // ── Store 读取 ────────────────────────────────────────────────
  const unbindTarget     = useGovernanceStore(s => s.unbindTarget)
  const closeUnbindModal = useGovernanceStore(s => s.closeUnbindModal)
  const user             = useAuthStore(s => s.user)

  // ── 本地状态 ──────────────────────────────────────────────────
  const [countdown,      setCountdown]      = useState(COUNTDOWN_SEC)
  const [isProcessing,   setIsProcessing]   = useState(false)
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null)
  /**
   * isLastEvidence：
   *   null  = 正在查询（不显示额外警告，避免闪烁）
   *   true  = 这是最后一张凭证（显示状态回退警告）
   *   false = 还有其他凭证
   */
  const [isLastEvidence, setIsLastEvidence] = useState<boolean | null>(null)

  // ── 每次目标变更：重置状态 + 启动倒计时 + 查询凭证数 ──────────
  useEffect(() => {
    if (!unbindTarget) return

    // 重置本地状态
    setCountdown(COUNTDOWN_SEC)
    setIsProcessing(false)
    setErrorMsg(null)
    setIsLastEvidence(null)

    // 启动 1 秒 interval 倒计时
    const timerId = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerId)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    // 异步查询当前账单共有几张凭证（判断是否为最后一张）
    getDocs(
      query(
        collection(db, 'evidences'),
        where('transactionId', '==', unbindTarget.transactionId),
      ),
    )
      .then(snap => setIsLastEvidence(snap.size === 1))
      .catch(() => setIsLastEvidence(null))  // 查询失败：静默，不显示警告

    return () => clearInterval(timerId)
  }, [unbindTarget?.evidenceId])  // evidenceId 变化 = 新解绑目标，触发重置

  // ── Modal 不可见时不渲染 DOM（不影响已有路由/组件） ──────────
  if (!unbindTarget) return null

  // ── 关闭操作（处理中时拦截，防止中途中断写入）────────────────
  function handleClose(): void {
    if (isProcessing) return
    closeUnbindModal()
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) handleClose()
  }

  // ── 确认解绑（委托 governanceService.unbindEvidence）──────────
  async function handleConfirm(): Promise<void> {
    if (!user || countdown > 0 || isProcessing) return

    setIsProcessing(true)
    setErrorMsg(null)

    try {
      await unbindEvidence(
        unbindTarget.evidenceId,
        unbindTarget.transactionId,
        user.uid,
      )
      // 成功：关闭弹窗（EvidenceList 的 onSnapshot 会自动刷新缩略图）
      closeUnbindModal()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '解绑失败，请检查网络后重试')
      setIsProcessing(false)
    }
  }

  const canConfirm = countdown === 0 && !isProcessing

  // ════════════════════════════════════════════════════════════════
  // § 3  渲染
  // ════════════════════════════════════════════════════════════════

  return (
    // 全屏遮罩：z-[400]（最高层级，高于 EvidenceUploaderModal z-[300] 和 EjectionBlocker z-[200]）
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center
                 bg-black/60 backdrop-blur-sm px-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-sm bg-surface-primary rounded-2xl shadow-2xl overflow-hidden">

        {/* ── 顶部警告色带（渐变）── */}
        <div className="h-1 w-full bg-gradient-to-r from-red-500 via-orange-400 to-red-500" />

        {/* ── 头部 ── */}
        <div className="flex items-start justify-between px-5 pt-5 pb-1">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none flex-shrink-0 mt-0.5">⚠️</span>
            <div>
              <h2 className="text-base font-bold text-content-primary">确认解绑凭证？</h2>
              <p className="text-[11px] text-content-tertiary mt-0.5">
                文件将从云端永久删除，并写入审计记录
              </p>
            </div>
          </div>
          {/* 关闭按钮（处理中时隐藏，避免误操作）*/}
          {!isProcessing && (
            <button
              type="button"
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-full
                         text-content-tertiary hover:text-content-primary
                         hover:bg-surface-secondary transition-colors text-lg leading-none
                         flex-shrink-0 -mt-0.5"
            >
              ×
            </button>
          )}
        </div>

        {/* ── 内容区 ── */}
        <div className="px-5 py-4 space-y-3">

          {/* 凭证预览卡片（有 URL 时展示缩略图）*/}
          {unbindTarget.evidenceUrl ? (
            <div className="flex items-center gap-3 px-3 py-2.5
                            bg-surface-secondary rounded-xl border border-border-primary">
              <img
                src={unbindTarget.evidenceUrl}
                alt="凭证预览"
                className="w-14 h-14 rounded-lg object-cover flex-shrink-0
                           border border-border-primary"
                onError={(e) => {
                  // 图片加载失败时替换为占位图标
                  ;(e.currentTarget as HTMLImageElement).replaceWith(
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
            // 无预览图时展示纯文本凭证信息
            <div className="px-3 py-2.5 bg-surface-secondary rounded-xl border border-border-primary">
              <p className="text-[11px] text-content-tertiary">凭证 ID</p>
              <p className="text-xs font-mono text-content-secondary mt-0.5 break-all">
                {unbindTarget.evidenceId}
              </p>
            </div>
          )}

          {/* ── 主警告区 ── */}
          <div className="px-3 py-3 bg-red-50 border border-red-200 rounded-xl space-y-2">

            {/* 基础警告 */}
            <p className="text-xs text-red-700 leading-relaxed">
              🗑 凭证文件将从 <strong>Firebase Storage</strong> 和数据库中<strong>永久删除</strong>，此操作不可撤销。系统将同步写入操作审计记录。
            </p>

            {/* 最后一张凭证额外警告（查询完成后才显示，避免闪烁）*/}
            {isLastEvidence === true && (
              <div className="pt-2 border-t border-red-200">
                <p className="text-xs text-orange-700 font-semibold leading-relaxed">
                  ⚡ 这是该账单的<strong>最后一张凭证</strong>。
                </p>
                <p className="text-xs text-orange-600 leading-relaxed mt-0.5">
                  解绑后，系统将自动执行<strong>历史回改</strong>：账单核实状态回退为「未核实」，该账单将重新出现在冲突中心的「待验证」队列，等待重新补传凭证。
                </p>
              </div>
            )}
          </div>

          {/* 错误提示 */}
          {errorMsg && (
            <div className="px-3 py-2.5 bg-red-50 border border-red-300 rounded-xl
                            flex items-start gap-2">
              <span className="text-sm flex-shrink-0 mt-0.5">🔴</span>
              <p className="text-xs text-red-600 leading-snug">{errorMsg}</p>
            </div>
          )}

        </div>

        {/* ── 底部操作区 ── */}
        <div className="flex items-center gap-2 px-5 pb-5">

          {/* 取消按钮 */}
          <button
            type="button"
            onClick={handleClose}
            disabled={isProcessing}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium
                       bg-surface-secondary text-content-secondary
                       hover:bg-surface-tertiary active:bg-surface-secondary
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>

          {/* 确认解绑按钮（含倒计时防呆 + loading 态）*/}
          <button
            type="button"
            onClick={() => { void handleConfirm() }}
            disabled={!canConfirm}
            className={[
              'flex-1 py-2.5 rounded-xl text-sm font-semibold',
              'flex items-center justify-center gap-2',
              'transition-all duration-300',
              canConfirm
                ? 'bg-red-500 hover:bg-red-600 active:bg-red-700 text-white shadow-sm cursor-pointer'
                : 'bg-red-100 text-red-300 cursor-not-allowed',
            ].join(' ')}
          >
            {isProcessing ? (
              // 处理中：旋转加载圈
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>解绑中…</span>
              </>
            ) : countdown > 0 ? (
              // 倒计时中：进度环 + 剩余秒数
              <>
                <CountdownRing current={countdown} total={COUNTDOWN_SEC} size={20} />
                <span>{countdown} 秒后可操作</span>
              </>
            ) : (
              // 可点击状态
              <>
                <span className="text-base leading-none">🗑</span>
                <span>确认永久删除</span>
              </>
            )}
          </button>

        </div>

      </div>
    </div>
  )
}
