// SettingsPage — 设置页 (S17 真实用户版)
// 新增：真实用户信息卡片 / 账套管理入口 / 登出按钮
// 数据来源：useAuthStore（Firebase Auth 用户对象）

import { useState }          from 'react'
import { useAuthStore }      from '@/store/authStore'
import { logout }            from '@/services/authService'
import { useLedger }         from '@/hooks/useLedger'
import LedgerManagerModal    from '@/components/ledger/LedgerManagerModal'

// ── 占位菜单项（未来阶段实现）─────────────────────────────────
type SettingItem = {
  icon:    string
  label:   string
  desc:    string
  badge?:  string
  danger?: boolean
}

const FUTURE_GROUPS: { title: string; items: SettingItem[] }[] = [
  {
    title: '数据管理',
    items: [
      { icon: '🏷️', label: '分类管理',  desc: '自定义账单分类与关键词',   badge: 'SX' },
      { icon: '📤', label: '导出数据',  desc: '导出为 CSV / Excel 文件',  badge: 'SX' },
    ],
  },
  {
    title: '关于',
    items: [
      { icon: '📋', label: '使用说明',  desc: '查看功能介绍与操作指南' },
      { icon: 'ℹ️', label: '版本信息',  desc: 'RMM V3 · 0.1.0-alpha · S17' },
    ],
  },
]

// ── 主组件 ─────────────────────────────────────────────────────
export default function SettingsPage() {
  const user    = useAuthStore(s => s.user)
  const { ledgers } = useLedger()

  const [showManager,  setShowManager]  = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)

  // 当前用户参与的账套数
  const myLedgerCount = user
    ? ledgers.filter(l => l.members.some(m => m.userId === user.uid)).length
    : 0

  async function handleLogout() {
    if (logoutLoading) return
    setLogoutLoading(true)
    try {
      await logout()
      // onAuthStateChanged 自动触发 → App 路由到 LoginPage
    } catch (e) {
      console.error('[SettingsPage] 登出失败:', e)
      setLogoutLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-5 pb-8">

      {/* ── 页面标题 ── */}
      <div className="pt-2">
        <h1 className="text-xl font-bold text-gray-900">设置</h1>
      </div>

      {/* ── 真实用户信息卡片 ── */}
      {user ? (
        <div className="card flex items-center gap-3">
          {/* 头像：优先 Google photoURL，fallback 首字母 */}
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt="头像"
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-full flex-shrink-0 object-cover ring-2 ring-white shadow"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600
                            flex items-center justify-center text-xl text-white font-bold flex-shrink-0">
              {(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">
              {user.displayName ?? '未设置昵称'}
            </p>
            <p className="text-xs text-gray-400 truncate mt-0.5">{user.email}</p>
          </div>

          {/* 已登录标识 */}
          <span className="text-[10px] font-bold px-2 py-1 bg-emerald-50 text-emerald-600
                           border border-emerald-200 rounded-full flex-shrink-0">
            已登录
          </span>
        </div>
      ) : (
        <div className="card flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-2xl">👤</div>
          <div>
            <p className="text-sm font-medium text-gray-700">未登录</p>
            <p className="text-xs text-primary-600 mt-0.5">请返回登录页</p>
          </div>
        </div>
      )}

      {/* ── 账套管理区块 ── */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2 px-1">账套</p>
        <div className="card divide-y divide-gray-50 p-0 overflow-hidden">

          {/* 管理账套入口 */}
          <button
            onClick={() => setShowManager(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
          >
            <span className="text-lg w-6 text-center">🗂️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700">账套管理</p>
              <p className="text-xs text-gray-400 truncate">
                创建账套、邀请成员、查看参与账套
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {myLedgerCount > 0 && (
                <span className="text-xs font-semibold text-primary-600 bg-primary-50
                                 px-2 py-0.5 rounded-full">
                  {myLedgerCount}
                </span>
              )}
              <span className="text-gray-300 text-sm">›</span>
            </div>
          </button>

        </div>
      </div>

      {/* ── 其他设置组（未来阶段） ── */}
      {FUTURE_GROUPS.map(group => (
        <div key={group.title}>
          <p className="text-xs font-medium text-gray-400 mb-2 px-1">{group.title}</p>
          <div className="card divide-y divide-gray-50 p-0 overflow-hidden">
            {group.items.map(item => (
              <button
                key={item.label}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50
                           transition-colors text-left"
              >
                <span className="text-lg w-6 text-center">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{item.label}</p>
                  <p className="text-xs text-gray-400 truncate">{item.desc}</p>
                </div>
                {item.badge ? (
                  <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                ) : (
                  <span className="text-gray-300 text-sm">›</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ── 账户安全 / 登出 ── */}
      {user && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2 px-1">账户</p>
          <div className="card p-0 overflow-hidden">
            <button
              onClick={handleLogout}
              disabled={logoutLoading}
              className="w-full flex items-center gap-3 px-4 py-3.5
                         hover:bg-red-50 active:bg-red-100
                         transition-colors text-left disabled:opacity-60"
            >
              <span className="text-lg w-6 text-center">
                {logoutLoading ? '⏳' : '🚪'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-red-600 font-medium">
                  {logoutLoading ? '正在登出…' : '退出登录'}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {user.email}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── LedgerManagerModal ── */}
      <LedgerManagerModal
        isOpen={showManager}
        onClose={() => setShowManager(false)}
      />

    </div>
  )
}
