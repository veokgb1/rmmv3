// LedgerManagerModal — 账套管理中心 (S17)
// 三视图状态机：list → create | detail
//
// list   视图：展示用户所有账套，区分 Owner / 成员身份；入口创建 / 进入详情
// create 视图：表单创建新账套（名称/类型/货币/时区/描述）
// detail 视图：账套详情 + 成员列表（Owner 可移除成员 + 邀请新成员）
//
// 数据流：
//   createLedger()  → Firestore addDoc → onSnapshot → ledgerStore → 列表自动更新
//   inviteMember()  → Firestore updateDoc → onSnapshot → ledgerStore → 成员列表刷新
//   removeMember()  → Firestore updateDoc → onSnapshot → ledgerStore → 成员消失

import { useState }                from 'react'
import { useLedger }               from '@/hooks/useLedger'
import { useAuthStore }            from '@/store/authStore'
import { createLedger, inviteMemberByEmail, removeMember }
                                   from '@/services/firebase/ledgerService'
import type { Ledger, LedgerType } from '@/types/Ledger.types'
import { getMemberRole, canWrite } from '@/types/Ledger.types'

// ── 视图类型 ──────────────────────────────────────────────────
type ModalView = 'list' | 'create' | 'detail'

// ── 常量 ──────────────────────────────────────────────────────
const LEDGER_TYPES: { value: LedgerType; label: string; icon: string; desc: string }[] = [
  { value: 'personal',   label: '个人',   icon: '👤', desc: '单人日常账本' },
  { value: 'family',     label: '家庭',   icon: '🏡', desc: '多成员家庭共账' },
  { value: 'enterprise', label: '企业',   icon: '🏢', desc: '团队项目账套' },
]

const CURRENCIES = [
  { value: 'CNY', label: '¥ 人民币 CNY' },
  { value: 'CAD', label: 'CA$ 加拿大元 CAD' },
  { value: 'USD', label: 'US$ 美元 USD' },
  { value: 'HKD', label: 'HK$ 港元 HKD' },
  { value: 'EUR', label: '€ 欧元 EUR' },
  { value: 'JPY', label: '¥ 日元 JPY' },
]

const TIMEZONES = [
  { value: 'Asia/Shanghai',       label: 'UTC+8 北京/上海' },
  { value: 'Asia/Hong_Kong',      label: 'UTC+8 香港' },
  { value: 'America/Toronto',     label: 'UTC-5/-4 多伦多' },
  { value: 'America/Vancouver',   label: 'UTC-8/-7 温哥华' },
  { value: 'America/New_York',    label: 'UTC-5/-4 纽约' },
  { value: 'Europe/London',       label: 'UTC+0/+1 伦敦' },
]

const TYPE_ICON_BG: Record<string, { bg: string; text: string }> = {
  personal:   { bg: 'bg-primary-50',  text: 'text-primary-600'  },
  family:     { bg: 'bg-green-50',    text: 'text-green-600'    },
  enterprise: { bg: 'bg-amber-50',    text: 'text-amber-600'    },
}

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥', CAD: 'CA$', USD: 'US$', HKD: 'HK$', EUR: '€', JPY: '¥',
}

// ────────────────────────────────────────────────────────────────────────────
// LedgerManagerModal
// ────────────────────────────────────────────────────────────────────────────
interface LedgerManagerModalProps {
  isOpen:  boolean
  onClose: () => void
}

export default function LedgerManagerModal({ isOpen, onClose }: LedgerManagerModalProps) {
  const { ledgers, ledgersReady } = useLedger()
  const currentUid = useAuthStore(s => s.user!.uid)

  const [view,            setView]            = useState<ModalView>('list')
  const [selectedLedger,  setSelectedLedger]  = useState<Ledger | null>(null)

  // ── 创建表单状态 ───────────────────────────────────────────
  const [createName,   setCreateName]   = useState('')
  const [createType,   setCreateType]   = useState<LedgerType>('personal')
  const [createCcy,    setCreateCcy]    = useState('CNY')
  const [createTz,     setCreateTz]     = useState('Asia/Shanghai')
  const [createDesc,   setCreateDesc]   = useState('')
  const [createLoading,setCreateLoading]= useState(false)
  const [createError,  setCreateError]  = useState('')

  // ── 邀请表单状态 ───────────────────────────────────────────
  const [inviteEmail,   setInviteEmail]  = useState('')
  const [inviteLoading, setInviteLoading]= useState(false)
  const [inviteError,   setInviteError]  = useState('')
  const [inviteSuccess, setInviteSuccess]= useState('')

  // ── 移除成员状态 ───────────────────────────────────────────
  const [removingUid, setRemovingUid]    = useState<string | null>(null)

  if (!isOpen) return null

  // 始终从 ledgerStore 中取最新账套数据（onSnapshot 驱动）
  const freshSelected = selectedLedger
    ? ledgers.find(l => l.id === selectedLedger.id) ?? selectedLedger
    : null

  // ── 导航 ───────────────────────────────────────────────────
  function goList() {
    setView('list')
    setSelectedLedger(null)
    resetInviteForm()
    resetCreateForm()
  }

  function goCreate() {
    resetCreateForm()
    setView('create')
  }

  function goDetail(ledger: Ledger) {
    setSelectedLedger(ledger)
    resetInviteForm()
    setView('detail')
  }

  function resetCreateForm() {
    setCreateName(''); setCreateType('personal'); setCreateCcy('CNY')
    setCreateTz('Asia/Shanghai'); setCreateDesc(''); setCreateError('')
  }

  function resetInviteForm() {
    setInviteEmail(''); setInviteError(''); setInviteSuccess('')
  }

  // ── 创建账套 ───────────────────────────────────────────────
  async function handleCreate() {
    if (!createName.trim()) { setCreateError('请输入账套名称'); return }
    setCreateLoading(true); setCreateError('')
    try {
      await createLedger(currentUid, {
        name:        createName,
        type:        createType,
        currency:    createCcy,
        timezone:    createTz,
        description: createDesc,
      })
      // onSnapshot 推送新账套后 ledgerStore 自动更新，UI 立即出现
      goList()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '创建失败，请重试')
    } finally {
      setCreateLoading(false)
    }
  }

  // ── 邀请成员 ───────────────────────────────────────────────
  async function handleInvite() {
    if (!freshSelected) return
    const email = inviteEmail.trim()
    if (!email) { setInviteError('请输入邮箱地址'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError('请输入有效的邮箱格式'); return
    }
    setInviteLoading(true); setInviteError(''); setInviteSuccess('')
    try {
      const { displayName } = await inviteMemberByEmail(
        freshSelected.id,
        email,
        freshSelected.members,
      )
      setInviteSuccess(`✅ 已邀请「${displayName}」加入账套`)
      setInviteEmail('')
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : '邀请失败，请重试')
    } finally {
      setInviteLoading(false)
    }
  }

  // ── 移除成员 ───────────────────────────────────────────────
  async function handleRemoveMember(targetUid: string) {
    if (!freshSelected) return
    setRemovingUid(targetUid)
    try {
      await removeMember(freshSelected.id, targetUid, freshSelected.members)
    } catch (e) {
      console.error('[LedgerManagerModal] 移除成员失败:', e)
    } finally {
      setRemovingUid(null)
    }
  }

  // ──────────────────────────────────────────────────────────
  // ① LIST 视图
  // ──────────────────────────────────────────────────────────
  function renderList() {
    return (
      <>
        {/* Header */}
        <ModalHeader title="账套管理" onClose={onClose} />

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 账套列表 */}
          {!ledgersReady ? (
            <div className="py-8 flex justify-center">
              <SpinnerIcon className="w-6 h-6 text-gray-300 animate-spin" />
            </div>
          ) : ledgers.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              <p className="text-3xl mb-3">📂</p>
              <p>暂无账套，点击下方新建一个吧</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {ledgers.filter(l => !l.isArchived).map(ledger => {
                const myRole   = getMemberRole(ledger, currentUid)
                const isOwner  = myRole === 'owner'
                const meta     = TYPE_ICON_BG[ledger.type] ?? TYPE_ICON_BG.personal
                const typeInfo = LEDGER_TYPES.find(t => t.value === ledger.type)
                const symbol   = CURRENCY_SYMBOL[ledger.currency] ?? ledger.currency

                return (
                  <button
                    key={ledger.id}
                    onClick={() => isOwner ? goDetail(ledger) : undefined}
                    className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors
                      ${isOwner ? 'hover:bg-gray-50 active:bg-gray-100 cursor-pointer' : 'cursor-default'}`}
                  >
                    {/* 类型图标 */}
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl
                                     flex-shrink-0 ${meta.bg} ${meta.text}`}>
                      {typeInfo?.icon ?? '📂'}
                    </div>

                    {/* 名称 + 描述 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-tight truncate">
                        {ledger.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {ledger.description || `${typeInfo?.desc ?? ''} · ${symbol}`}
                      </p>
                    </div>

                    {/* 右侧信息 */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {/* 身份徽标 */}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                        ${isOwner
                          ? 'bg-amber-50 text-amber-600 border border-amber-200'
                          : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
                        {isOwner ? '👑 创建者' : '👤 参与者'}
                      </span>

                      {/* 成员数 */}
                      <span className="text-[10px] text-gray-400">
                        {ledger.members.length} 名成员
                      </span>
                    </div>

                    {/* Owner 才有箭头入口 */}
                    {isOwner && (
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer：创建账套 */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100">
          <button
            onClick={goCreate}
            className="w-full py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold
                       hover:bg-primary-700 active:scale-[0.98] transition-all shadow-sm"
          >
            ＋ 创建新账套
          </button>
        </div>
      </>
    )
  }

  // ──────────────────────────────────────────────────────────
  // ② CREATE 视图
  // ──────────────────────────────────────────────────────────
  function renderCreate() {
    return (
      <>
        {/* Header */}
        <ModalHeader title="创建账套" onBack={goList} onClose={onClose} />

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">

          {/* 名称 */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">
              账套名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder="如：全家福、日本旅行、明报加拿大"
              maxLength={30}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-transparent
                         bg-gray-50 text-sm text-gray-900 outline-none
                         focus:border-primary-300 focus:bg-white transition-all
                         placeholder:text-gray-300"
            />
          </div>

          {/* 账套类型 */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">账套类型</label>
            <div className="grid grid-cols-3 gap-2">
              {LEDGER_TYPES.map(t => {
                const selected = createType === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setCreateType(t.value)}
                    className={`py-3 rounded-xl text-xs font-medium transition-all flex flex-col
                                items-center gap-1 border-2
                      ${selected
                        ? 'bg-primary-50 border-primary-400 text-primary-700'
                        : 'bg-gray-50 border-transparent text-gray-500 hover:border-gray-200'}`}
                  >
                    <span className="text-xl">{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 货币 */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">货币</label>
            <select
              value={createCcy}
              onChange={e => setCreateCcy(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-transparent
                         bg-gray-50 text-sm text-gray-900 outline-none
                         focus:border-primary-300 focus:bg-white transition-all"
            >
              {CURRENCIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* 时区 */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">时区</label>
            <select
              value={createTz}
              onChange={e => setCreateTz(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-transparent
                         bg-gray-50 text-sm text-gray-900 outline-none
                         focus:border-primary-300 focus:bg-white transition-all"
            >
              {TIMEZONES.map(z => (
                <option key={z.value} value={z.value}>{z.label}</option>
              ))}
            </select>
          </div>

          {/* 描述（选填） */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">
              描述 <span className="text-gray-300 font-normal">（选填）</span>
            </label>
            <input
              type="text"
              value={createDesc}
              onChange={e => setCreateDesc(e.target.value)}
              placeholder="一句话说明这个账套的用途"
              maxLength={60}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-transparent
                         bg-gray-50 text-sm text-gray-900 outline-none
                         focus:border-primary-300 focus:bg-white transition-all
                         placeholder:text-gray-300"
            />
          </div>

        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 space-y-2">
          {createError && (
            <p className="text-xs text-red-500 text-center">⚠️ {createError}</p>
          )}
          <button
            onClick={handleCreate}
            disabled={createLoading}
            className="w-full py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold
                       hover:bg-primary-700 active:scale-[0.98] transition-all shadow-sm
                       disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {createLoading ? (
              <><SpinnerIcon className="w-4 h-4 animate-spin" /><span>创建中…</span></>
            ) : '🚀 创建账套'}
          </button>
        </div>
      </>
    )
  }

  // ──────────────────────────────────────────────────────────
  // ③ DETAIL 视图（Owner Only）
  // ──────────────────────────────────────────────────────────
  function renderDetail() {
    const ledger = freshSelected
    if (!ledger) return null

    const isOwner  = getMemberRole(ledger, currentUid) === 'owner'
    const typeInfo = LEDGER_TYPES.find(t => t.value === ledger.type)
    const meta     = TYPE_ICON_BG[ledger.type] ?? TYPE_ICON_BG.personal
    const symbol   = CURRENCY_SYMBOL[ledger.currency] ?? ledger.currency

    return (
      <>
        {/* Header */}
        <ModalHeader title={ledger.name} onBack={goList} onClose={onClose} />

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* 账套信息卡片 */}
          <div className="px-5 py-4 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl
                               flex-shrink-0 ${meta.bg} ${meta.text}`}>
                {typeInfo?.icon ?? '📂'}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{ledger.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {typeInfo?.label}账套 · {symbol} · {ledger.members.length} 名成员
                </p>
                {ledger.description && (
                  <p className="text-xs text-gray-500 mt-1">{ledger.description}</p>
                )}
              </div>
            </div>
          </div>

          {/* 成员列表 */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3">
              成员（{ledger.members.length}）
            </p>

            <div className="space-y-2">
              {ledger.members.map(member => {
                const isMe       = member.userId === currentUid
                const isMemberOwner = member.role === 'owner'
                const initial    = (member.nickname ?? member.userId).charAt(0).toUpperCase()
                const isRemoving = removingUid === member.userId

                return (
                  <div key={member.userId}
                    className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-gray-50">

                    {/* 头像占位（初始字母） */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center
                                     text-sm font-bold flex-shrink-0
                                     ${isMemberOwner
                                       ? 'bg-amber-100 text-amber-700'
                                       : 'bg-blue-100 text-blue-700'}`}>
                      {initial}
                    </div>

                    {/* 名称 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {member.nickname ?? member.userId.slice(0, 8) + '…'}
                        {isMe && <span className="ml-1 text-xs text-gray-400">（我）</span>}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(member.joinedAt).toLocaleDateString('zh-CN')} 加入
                      </p>
                    </div>

                    {/* 角色徽标 */}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0
                      ${isMemberOwner
                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                        : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
                      {isMemberOwner ? '👑 Owner' : '👤 成员'}
                    </span>

                    {/* 移除按钮（owner 才显示，且不能移除自己/其他 owner） */}
                    {isOwner && !isMemberOwner && !isMe && (
                      <button
                        onClick={() => handleRemoveMember(member.userId)}
                        disabled={isRemoving}
                        title="移除此成员"
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0
                                   text-gray-400 hover:text-red-500 hover:bg-red-50
                                   transition-all disabled:opacity-40"
                      >
                        {isRemoving
                          ? <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
                          : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12" />
                            </svg>}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 邀请成员（Owner Only） */}
          {isOwner && (
            <div className="px-5 pt-4 pb-5">
              <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3">
                邀请成员
              </p>

              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <p className="text-xs text-gray-500">
                  输入对方的注册邮箱，对方须已登录过 RMM V3。
                </p>

                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => {
                      setInviteEmail(e.target.value)
                      setInviteError('')
                      setInviteSuccess('')
                    }}
                    placeholder="对方的邮箱地址"
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    className="flex-1 px-3 py-2.5 rounded-xl border-2 border-transparent
                               bg-white text-sm text-gray-900 outline-none
                               focus:border-primary-300 transition-all
                               placeholder:text-gray-300"
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviteLoading}
                    className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-xs font-bold
                               hover:bg-primary-700 active:scale-[0.97] transition-all
                               disabled:opacity-60 disabled:cursor-not-allowed
                               flex items-center gap-1.5 flex-shrink-0"
                  >
                    {inviteLoading
                      ? <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
                      : '邀请'}
                  </button>
                </div>

                {inviteError && (
                  <p className="text-xs text-red-500">⚠️ {inviteError}</p>
                )}
                {inviteSuccess && (
                  <p className="text-xs text-emerald-600">{inviteSuccess}</p>
                )}
              </div>
            </div>
          )}

          {/* 非 Owner 只读提示 */}
          {!isOwner && canWrite(ledger, currentUid) && (
            <div className="px-5 py-4">
              <p className="text-xs text-gray-400 text-center">
                你是此账套的参与者，可以录入账单，但无法管理成员
              </p>
            </div>
          )}
        </div>
      </>
    )
  }

  // ──────────────────────────────────────────────────────────
  // 主渲染
  // ──────────────────────────────────────────────────────────
  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal 居中定位层 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="w-[95%] sm:max-w-md bg-white rounded-2xl shadow-xl
                     max-h-[90dvh] flex flex-col overflow-hidden pointer-events-auto
                     animate-[slideUp_0.22s_ease-out]"
          onClick={e => e.stopPropagation()}
        >
          {view === 'list'   && renderList()}
          {view === 'create' && renderCreate()}
          {view === 'detail' && renderDetail()}
        </div>
      </div>
    </>
  )
}

// ── 共享子组件 ────────────────────────────────────────────────

interface ModalHeaderProps {
  title:   string
  onClose: () => void
  onBack?: () => void
}

function ModalHeader({ title, onClose, onBack }: ModalHeaderProps) {
  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4
                    border-b border-gray-100/80">
      {/* 返回按钮（二级视图） */}
      {onBack && (
        <button
          onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-full
                     bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      <h2 className="flex-1 text-base font-bold text-gray-900">{title}</h2>

      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="w-7 h-7 flex items-center justify-center rounded-full
                   bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors flex-shrink-0"
      >
        ✕
      </button>
    </div>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
