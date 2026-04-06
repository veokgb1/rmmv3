// LoginPage — 双轨登录页 (S18 适老化版)
//
// 双轨方案：
//   轨道 A：Google 弹窗一键登录（科技用户，原 S16 功能不变）
//   轨道 B：邮箱 + 密码登录 / 注册（适老化场景，无需 Google 账号）
//
// 适老化设计要点：
//   - 表单字段间距充足，字体清晰
//   - 登录/注册模式 Tab 切换，操作路径无歧义
//   - 错误提示中文友好，精确指向具体字段
//   - 密码显示/隐藏眼睛按钮，减少输错困惑

import { useState } from 'react'
import {
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
} from '@/services/authService'

// ── 邮箱表单模式 ──────────────────────────────────────────────
type EmailMode = 'login' | 'register'

// ── 错误码翻译表（双轨合并） ──────────────────────────────────
function getAuthErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return '操作失败，请重试'
  const code = (err as { code?: string }).code ?? ''

  const map: Record<string, string> = {
    // Google 登录
    'auth/popup-closed-by-user':    '登录窗口已关闭，请重新点击',
    'auth/popup-blocked':           '浏览器阻止了弹窗，请允许后重试',
    'auth/cancelled-popup-request': '登录请求已取消',
    // 邮箱登录
    'auth/invalid-credential':      '邮箱或密码错误，请重新输入',
    'auth/user-not-found':          '该邮箱未注册，请先注册账号',
    'auth/wrong-password':          '密码错误，请重新输入',
    'auth/invalid-email':           '邮箱格式不正确',
    'auth/user-disabled':           '该账号已被禁用，请联系管理员',
    // 注册
    'auth/email-already-in-use':    '该邮箱已被注册，请直接登录',
    'auth/weak-password':           '密码至少需要 6 位字符',
    // 通用
    'auth/network-request-failed':  '网络连接失败，请检查网络后重试',
    'auth/too-many-requests':       '操作过于频繁，请稍后再试',
    'auth/operation-not-allowed':   '该登录方式未启用，请联系管理员',
  }

  return map[code] ?? `出错了（${code || err.message.slice(0, 50)}）`
}

// ── 主组件 ────────────────────────────────────────────────────
export default function LoginPage() {
  // ── Google 登录状态 ─────────────────────────────────────────
  const [googleLoading, setGoogleLoading] = useState(false)

  // ── 邮箱表单状态 ─────────────────────────────────────────────
  const [emailMode,       setEmailMode]       = useState<EmailMode>('login')
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword,    setShowPassword]    = useState(false)
  const [emailLoading,    setEmailLoading]    = useState(false)

  // ── 共享错误 Toast ────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState('')

  const anyLoading = googleLoading || emailLoading

  // ── Google 登录 ──────────────────────────────────────────────
  async function handleGoogleLogin() {
    if (anyLoading) return
    setGoogleLoading(true)
    setErrorMsg('')
    try {
      await loginWithGoogle()
    } catch (err) {
      setErrorMsg(getAuthErrorMessage(err))
      setGoogleLoading(false)
    }
  }

  // ── 邮箱表单提交 ─────────────────────────────────────────────
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (anyLoading) return
    setErrorMsg('')

    // 客户端简单校验
    if (!email.trim()) { setErrorMsg('请输入邮箱地址'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErrorMsg('邮箱格式不正确'); return }
    if (!password)      { setErrorMsg('请输入密码'); return }
    if (emailMode === 'register') {
      if (password.length < 6)           { setErrorMsg('密码至少需要 6 位字符'); return }
      if (password !== confirmPassword)  { setErrorMsg('两次输入的密码不一致'); return }
    }

    setEmailLoading(true)
    try {
      if (emailMode === 'login') {
        await loginWithEmail(email, password)
      } else {
        await registerWithEmail(email, password)
      }
      // 成功 → onAuthStateChanged 自动触发 → App 路由到主应用
    } catch (err) {
      setErrorMsg(getAuthErrorMessage(err))
      setEmailLoading(false)
    }
  }

  // ── 切换登录/注册 ─────────────────────────────────────────────
  function switchMode(mode: EmailMode) {
    setEmailMode(mode)
    setErrorMsg('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
  }

  return (
    // 外层：可滚动，移动端小屏时表单不被截断
    <div className="min-h-screen overflow-y-auto flex items-start sm:items-center
                    justify-center py-6 bg-gray-950 relative">

      {/* ── 背景装饰 ──────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none select-none" aria-hidden>
        <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full
                        bg-emerald-900/20 blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[50vw] h-[50vw] rounded-full
                        bg-cyan-900/20 blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.025]" style={{
          backgroundImage: `
            linear-gradient(rgba(16,185,129,.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16,185,129,.8) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }} />
      </div>

      {/* ── 主卡片 ───────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className="bg-gray-900/85 backdrop-blur-xl border border-gray-700/50
                        rounded-2xl p-7 shadow-2xl">

          {/* Logo & 标题 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                            bg-gradient-to-br from-emerald-500 to-cyan-500 mb-3
                            shadow-lg shadow-emerald-500/20">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504
                     1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125
                     1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125
                     1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0
                     .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0
                     01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125
                     1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0
                     .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0
                     01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              RMM<span className="text-emerald-400"> V3</span>
            </h1>
            <p className="text-xs text-gray-500 mt-1">资金管理系统 · 家庭共享版</p>
          </div>

          {/* ══ 轨道 A：Google 一键登录 ══════════════════════════ */}
          <button
            type="button"
            disabled={anyLoading}
            onClick={handleGoogleLogin}
            className={[
              'w-full flex items-center justify-center gap-3',
              'px-5 py-3 rounded-xl font-medium text-sm transition-all duration-200',
              anyLoading
                ? 'bg-gray-700/60 text-gray-500 cursor-not-allowed'
                : 'bg-white hover:bg-gray-50 text-gray-800 shadow-md hover:shadow-lg active:scale-[0.98]',
            ].join(' ')}
          >
            {googleLoading ? (
              <><Spinner className="w-4 h-4 text-gray-400" /><span>登录中…</span></>
            ) : (
              <><GoogleLogo /><span>使用 Google 账号登录</span></>
            )}
          </button>

          {/* ══ 分隔线 ════════════════════════════════════════════ */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-700/60" />
            <span className="text-xs text-gray-500 font-medium tracking-widest">或</span>
            <div className="flex-1 h-px bg-gray-700/60" />
          </div>

          {/* ══ 轨道 B：邮箱密码 ══════════════════════════════════ */}
          {/* 登录 / 注册 模式 Tab */}
          <div className="flex p-1 bg-gray-800/60 rounded-xl mb-5 gap-1">
            {(['login', 'register'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                disabled={anyLoading}
                onClick={() => switchMode(mode)}
                className={[
                  'flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
                  emailMode === mode
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200',
                ].join(' ')}
              >
                {mode === 'login' ? '登录' : '注册新账号'}
              </button>
            ))}
          </div>

          {/* 邮箱密码表单 */}
          <form onSubmit={handleEmailSubmit} noValidate className="space-y-3">

            {/* 邮箱 */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                邮箱地址
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErrorMsg('') }}
                placeholder="example@qq.com"
                autoComplete="email"
                disabled={anyLoading}
                className="w-full px-4 py-3 rounded-xl bg-gray-800/60 border border-gray-700/50
                           text-white text-sm placeholder:text-gray-600
                           focus:outline-none focus:border-emerald-500/70 focus:bg-gray-800
                           disabled:opacity-50 transition-all"
              />
            </div>

            {/* 密码 */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                密码{emailMode === 'register' && <span className="text-gray-600 font-normal ml-1">（至少 6 位）</span>}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setErrorMsg('') }}
                  placeholder={emailMode === 'login' ? '请输入密码' : '设置登录密码'}
                  autoComplete={emailMode === 'login' ? 'current-password' : 'new-password'}
                  disabled={anyLoading}
                  className="w-full px-4 py-3 pr-11 rounded-xl bg-gray-800/60 border border-gray-700/50
                             text-white text-sm placeholder:text-gray-600
                             focus:outline-none focus:border-emerald-500/70 focus:bg-gray-800
                             disabled:opacity-50 transition-all"
                />
                {/* 显示/隐藏密码 */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2
                             text-gray-500 hover:text-gray-300 transition-colors"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* 确认密码（注册模式） */}
            {emailMode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  确认密码
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setErrorMsg('') }}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  disabled={anyLoading}
                  className="w-full px-4 py-3 rounded-xl bg-gray-800/60 border border-gray-700/50
                             text-white text-sm placeholder:text-gray-600
                             focus:outline-none focus:border-emerald-500/70 focus:bg-gray-800
                             disabled:opacity-50 transition-all"
                />
              </div>
            )}

            {/* 错误提示 */}
            {errorMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl
                              bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
                <span className="flex-shrink-0 mt-0.5">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={anyLoading}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200
                         bg-emerald-600 text-white hover:bg-emerald-500
                         active:scale-[0.98] shadow-md hover:shadow-lg
                         disabled:opacity-60 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {emailLoading
                ? <><Spinner className="w-4 h-4" /><span>处理中…</span></>
                : emailMode === 'login' ? '登录' : '注册并登录'
              }
            </button>
          </form>

          {/* 底部帮助提示 */}
          <p className="text-center text-gray-600 text-xs mt-5 leading-relaxed">
            {emailMode === 'login'
              ? <>没有账号？<button type="button" onClick={() => switchMode('register')}
                  className="text-emerald-500 hover:text-emerald-400 underline underline-offset-2">
                  点此注册
                </button></>
              : <>已有账号？<button type="button" onClick={() => switchMode('login')}
                  className="text-emerald-500 hover:text-emerald-400 underline underline-offset-2">
                  直接登录
                </button></>
            }
          </p>

          <p className="text-center text-gray-700 text-[11px] mt-4">
            RMM V3 · Powered by Firebase Auth
          </p>
        </div>
      </div>
    </div>
  )
}

// ── 图标组件 ──────────────────────────────────────────────────
function GoogleLogo() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`${className ?? ''} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
           -1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7
           a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878
           9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59
           3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025
           10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}
