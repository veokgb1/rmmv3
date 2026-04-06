// authService — Firebase Auth 认证服务 (S16)
// 封装 Google 弹窗登录、登出，以及 onAuthStateChanged 监听器
// 所有认证操作通过此文件统一调用，禁止在业务组件中直接导入 firebase/auth

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type User,
  type NextOrObserver,
} from 'firebase/auth'
import { auth } from '@/config/firebase'

// ── Google 登录 ────────────────────────────────────────────────
/**
 * loginWithGoogle — 弹窗式 Google 账号登录
 * 调用方捕获异常并展示 Toast 错误提示
 * 登录成功后 onAuthStateChanged 自动触发，authStore 状态将自动更新
 */
export async function loginWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider()
  // 每次弹窗都要求用户选择账号（防止静默复用上次账号造成困惑）
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithPopup(auth, provider)
}

// ── 邮箱密码登录 ───────────────────────────────────────────────
/**
 * loginWithEmail — 邮箱 + 密码登录（适老化场景）
 * 登录成功后 onAuthStateChanged 自动触发，authStore 状态将自动更新
 */
export async function loginWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password)
}

// ── 邮箱密码注册 ───────────────────────────────────────────────
/**
 * registerWithEmail — 邮箱 + 密码注册新账号
 * 注册即登录：Firebase 注册成功后自动处于登录态
 * displayName 由 ensureUserProfile（在 authStore 的 onAuthStateChanged 中调用）
 * 以 email 前缀填充
 */
export async function registerWithEmail(email: string, password: string): Promise<void> {
  await createUserWithEmailAndPassword(auth, email.trim(), password)
}

// ── 登出 ───────────────────────────────────────────────────────
/**
 * logout — 登出当前用户
 * 登出后 onAuthStateChanged 自动触发 user=null，App 自动跳回 LoginPage
 */
export async function logout(): Promise<void> {
  await signOut(auth)
}

// ── Auth 状态监听 ──────────────────────────────────────────────
/**
 * subscribeToAuth — 订阅 Firebase Auth 状态变化
 * 返回 unsubscribe 函数，调用方负责在组件卸载时清理
 *
 * 设计：由 authStore.startAuthListener() 统一调用，
 *       不在组件层直接订阅，保持单一数据源
 */
export function subscribeToAuth(callback: NextOrObserver<User>): () => void {
  return onAuthStateChanged(auth, callback)
}
