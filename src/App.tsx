// App 根组件 — S16 Firebase Auth 路由保护版
//
// 路由状态机：
//   authReady=false → 全局 Loading（Firebase SDK 恢复登录态中）
//   authReady=true, user=null → LoginPage（未登录）
//   authReady=true, user≠null → MainApp（已登录，启动 Firestore 监听）
//
// 关键设计：MainApp 仅在登录后挂载，useFirestoreSync 因此只在登录后启动

import { useEffect }          from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

import HomePage     from '@/pages/HomePage'
import QueryPage    from '@/pages/QueryPage'
import ReportPage   from '@/pages/ReportPage'
import SettingsPage from '@/pages/SettingsPage'
import LoginPage    from '@/pages/LoginPage'
import BottomNav    from '@/components/layout/BottomNav'

import { useFirestoreSync }               from '@/hooks/useFirestoreSync'
import { useAuthStore, startAuthListener } from '@/store/authStore'
import EjectionBlocker                    from '@/components/ledger/EjectionBlocker'

// ── 全局 Loading 骨架 ──────────────────────────────────────────
function GlobalLoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 gap-4">
      {/* 旋转圈 */}
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20" />
        <div className="absolute inset-0 rounded-full border-2 border-t-emerald-500 animate-spin" />
      </div>
      <p className="text-sm text-gray-500 tracking-widest">RMM V3 启动中…</p>
    </div>
  )
}

// ── 主应用（仅在登录后挂载） ───────────────────────────────────
// 独立为子组件：挂载时才调用 useFirestoreSync，确保监听在有 uid 时才启动
// S18：EjectionBlocker 作为全局顶层组件挂载，z-[200] 确保覆盖所有 Modal
function MainApp() {
  useFirestoreSync()

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <main className="flex-1 pb-16 overflow-y-auto">
          <Routes>
            <Route path="/"         element={<Navigate to="/home" replace />} />
            <Route path="/home"     element={<HomePage />} />
            <Route path="/query"    element={<QueryPage />} />
            <Route path="/report"   element={<ReportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*"         element={<Navigate to="/home" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>

      {/* S18：越权阻断层 — 全局单例，挂在路由树之外保证任何页面都能触发 */}
      <EjectionBlocker />
    </BrowserRouter>
  )
}

// ── 根组件 ─────────────────────────────────────────────────────
function App() {
  const { user, authReady } = useAuthStore()

  // Auth 监听：App 挂载时启动一次，持续监听整个应用生命周期
  useEffect(() => {
    const unsub = startAuthListener()
    return unsub
  }, [])

  // 阶段 1：Firebase SDK 恢复持久化登录中
  if (!authReady) {
    return <GlobalLoadingScreen />
  }

  // 阶段 2：Auth 就绪但无用户 → 登录页
  if (!user) {
    return <LoginPage />
  }

  // 阶段 3：已登录 → 挂载主应用（含 Firestore 实时监听）
  return <MainApp />
}

export default App
