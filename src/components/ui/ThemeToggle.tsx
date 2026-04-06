// ThemeToggle — 浅色/暗色主题切换按钮
//
// 工作原理：
//   1. 挂载时从 localStorage 读取用户上次选择的主题
//   2. 点击时在 document.documentElement 上切换 "dark" 类名
//   3. html.dark 触发 index.css 中 CSS 变量覆盖 → 全局色彩自动切换
//   4. Tailwind semantic colors（surface.* / content.* 等）均已指向 CSS 变量
//      → 所有已使用这些 token 的组件无需任何改动即可适配暗色
//
// 持久化：localStorage key = 'rmmv3-theme'，值为 'dark' | 'light'

import { useState, useEffect } from 'react'

// localStorage 持久化 key
const STORAGE_KEY = 'rmmv3-theme'

// 从 localStorage 或系统偏好读取初始主题
function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* SSR/隐私模式容错 */ }
  // 未保存时，跟随系统偏好（prefers-color-scheme）
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 将主题应用到 <html> 元素（同步 CSS 变量生效）
function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

// ─────────────────────────────────────────────────────────────
// ThemeToggle 组件
// ─────────────────────────────────────────────────────────────
interface ThemeToggleProps {
  /** 额外 className，用于定位（默认无） */
  className?: string
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  // 本地 React 状态同步 DOM 状态（用于按钮图标切换）
  const [theme, setTheme] = useState<'dark' | 'light'>('light')

  // 挂载时：读取持久化主题并应用
  useEffect(() => {
    const initial = getInitialTheme()
    setTheme(initial)
    applyTheme(initial)
  }, [])

  // 点击切换
  function toggle() {
    const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)  // 持久化用户选择
    } catch { /* 隐私模式下 localStorage 不可写，静默忽略 */ }
  }

  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      title={isDark ? '切换为浅色模式' : '切换为暗色模式'}
      aria-label={isDark ? '切换为浅色模式' : '切换为暗色模式'}
      className={`
        w-9 h-9 rounded-full flex items-center justify-center
        bg-surface-overlay hover:bg-gray-200 dark:hover:bg-slate-700
        text-content-secondary transition-all duration-200
        active:scale-90 no-select
        ${className}
      `}
    >
      {/* 暗色模式时显示太阳（切回白天），浅色时显示月亮 */}
      {isDark ? (
        // ☀️ 太阳图标
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85 1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM4 11v2H1v-2h3z"/>
        </svg>
      ) : (
        // 🌙 月亮图标
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 7a7 7 0 0 0 12 4.9v.1c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2h.1A6.979 6.979 0 0 0 10 7zm-6 5a8 8 0 0 0 15.062 3.762A9 9 0 0 1 8.238 4.938 7.999 7.999 0 0 0 4 12z"/>
        </svg>
      )}
    </button>
  )
}
