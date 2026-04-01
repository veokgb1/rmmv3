// 根组件：负责全局路由配置和布局骨架 (S5 Firebase 实时版)
// useFirestoreSync 在此挂载：建立 ledgers + transactions 的 onSnapshot 监听
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

// 引入四个核心页面组件
import HomePage    from '@/pages/HomePage'
import QueryPage   from '@/pages/QueryPage'
import ReportPage  from '@/pages/ReportPage'
import SettingsPage from '@/pages/SettingsPage'

// 引入底部导航栏组件（移动端主导航）
import BottomNav from '@/components/layout/BottomNav'

// S5：Firestore 实时监听生命周期管理（全局唯一实例）
import { useFirestoreSync } from '@/hooks/useFirestoreSync'

/**
 * App 根组件
 * 架构说明：
 *  - BrowserRouter 提供 HTML5 History API 路由能力
 *  - useFirestoreSync：管理 ledgers + transactions 的 onSnapshot 生命周期
 *  - 所有页面共享同一个 BottomNav 导航栏
 *  - 根路径 "/" 自动重定向到首页 "/home"
 */
function App() {
  // 全局 Firestore 实时监听（挂载建立，卸载清理）
  useFirestoreSync()

  return (
    // BrowserRouter：启用基于 URL 路径的路由
    <BrowserRouter>
      {/* 整体布局：最高占满视口高度，flex 列方向 */}
      <div className="min-h-screen flex flex-col bg-gray-50">

        {/* 页面内容区：flex-1 撑满剩余空间，底部留出导航栏高度 */}
        <main className="flex-1 pb-16 overflow-y-auto">
          <Routes>
            {/* 根路径重定向到首页 */}
            <Route path="/" element={<Navigate to="/home" replace />} />

            {/* 首页：账单总览与快速记账入口 */}
            <Route path="/home" element={<HomePage />} />

            {/* 查询页：账单列表、搜索、筛选 */}
            <Route path="/query" element={<QueryPage />} />

            {/* 报表页：统计图表与月度分析 */}
            <Route path="/report" element={<ReportPage />} />

            {/* 设置页：用户偏好、分类管理 */}
            <Route path="/settings" element={<SettingsPage />} />

            {/* 兜底路由：未匹配的路径跳回首页 */}
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </main>

        {/* 底部导航栏：固定在底部，所有页面共享 */}
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}

// 导出根组件供 main.tsx 使用
export default App
