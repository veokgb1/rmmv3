// authStore — Firebase Auth 全局状态机 (S16)
// 存储当前真实登录用户与 Auth 就绪状态
// 严守单向数据流：onAuthStateChanged → setUser/setAuthReady → UI 响应
//
// 设计决策：不使用 persist，Auth 状态由 Firebase SDK 自行管理持久化
// Firebase Auth 默认使用 IndexedDB 保持登录态，无需我们手动 localStorage

import { create }              from 'zustand'
import type { User }           from 'firebase/auth'
import { subscribeToAuth }     from '@/services/authService'
import { ensureUserProfile }   from '@/services/firebase/userService'

// ── Store 状态接口 ─────────────────────────────────────────────
interface AuthState {
  /** 当前登录用户（null = 未登录） */
  user:      User | null

  /**
   * authReady — Firebase Auth 初始化是否完成
   * Firebase SDK 在页面加载后需要约 200-500ms 恢复持久化登录态
   * authReady=false 期间：显示全局 Loading，禁止渲染任何业务路由
   * authReady=true 后：根据 user 是否为 null 决定路由走向
   */
  authReady: boolean

  setUser:      (user: User | null) => void
  setAuthReady: (ready: boolean)    => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user:      null,
  authReady: false,

  setUser:      (user)  => set({ user }),
  setAuthReady: (ready) => set({ authReady: ready }),
}))

// ─────────────────────────────────────────────────────────────
// startAuthListener — 启动 Firebase Auth 状态监听
//
// 调用时机：App 根组件挂载时调用一次（useEffect 空依赖）
// 返回值：unsubscribe 函数（组件卸载时调用，防止内存泄漏）
//
// 完整生命周期：
//   1. 页面加载 → authReady=false（App 显示全局 Loading）
//   2. Firebase SDK 恢复持久化登录 → onAuthStateChanged 触发
//   3. 设置 user + authReady=true → App 根据 user 路由到登录页或主应用
//   4. 用户登出 → onAuthStateChanged 触发 user=null → App 跳回登录页
// ─────────────────────────────────────────────────────────────
export function startAuthListener(): () => void {
  const { setUser, setAuthReady } = useAuthStore.getState()

  return subscribeToAuth((firebaseUser) => {
    // 登录时：fire-and-forget 同步 UserProfile（不阻塞 App 启动）
    // users/{uid} 文档不存在时创建，已存在时更新 displayName/photoURL
    if (firebaseUser) {
      ensureUserProfile(firebaseUser).catch(err =>
        console.warn('[authStore] UserProfile 同步失败（非致命）:', err)
      )
    }

    setUser(firebaseUser)
    setAuthReady(true)

    if (import.meta.env.DEV) {
      console.debug(
        '[authStore]',
        firebaseUser ? `✅ 已登录: ${firebaseUser.displayName} (${firebaseUser.uid})` : '🚪 未登录',
      )
    }
  })
}
