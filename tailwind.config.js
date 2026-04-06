// Tailwind CSS 配置文件 — S2 版本
// 扩展了完整的设计系统色板：主色、语义色、背景层级
/** @type {import('tailwindcss').Config} */
export default {
  // 扫描范围：Tailwind 只打包实际用到的 class，减小产物体积
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],

  // 暗色模式：通过在 <html> 上切换 class="dark" 来触发
  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        // ── 品牌主色：青绿（代表财务稳健感） ──────────────────
        primary: {
          50:  '#f0fdf9',   // 极浅背景，用于选中态底色
          100: '#ccfbef',   // 浅色标签背景
          200: '#99f6e0',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',   // 正常态按钮
          600: '#0d9488',   // hover 态按钮（默认交互色）
          700: '#0f766e',   // 按下态
          800: '#115e59',
          900: '#134e4a',
        },

        // ── 语义色：收入绿（指向 CSS 变量，自动响应暗色模式）────
        income: {
          DEFAULT: 'var(--color-income)',     // 收入金额文字
          bg:      'var(--color-income-bg)',  // 收入条目背景
          light:   '#86efac',                 // 收入图标/标签（固定，暗色也适用）
        },

        // ── 语义色：支出红 ──────────────────────────────────────
        expense: {
          DEFAULT: 'var(--color-expense)',    // 支出金额文字
          bg:      'var(--color-expense-bg)', // 支出条目背景
          light:   '#fca5a5',                 // 支出图标/标签（固定）
        },

        // ── 背景层级系统（CSS 变量驱动，html.dark 自动切换）────
        surface: {
          page:    'var(--color-bg-page)',    // 页面底色
          card:    'var(--color-bg-card)',    // 卡片背景
          overlay: 'var(--color-bg-overlay)',// 输入框、标签等
        },

        // ── 文字层级系统 ────────────────────────────────────────
        content: {
          primary:   'var(--color-text-primary)',   // 主要文字
          secondary: 'var(--color-text-secondary)', // 次要文字
          tertiary:  'var(--color-text-tertiary)',  // 辅助文字
          inverse:   '#ffffff',                      // 反色文字（恒白，置于深色背景）
        },

        // ── 边框色 ──────────────────────────────────────────────
        border: {
          DEFAULT: 'var(--color-border)',       // 默认边框
          light:   'var(--color-border-light)', // 轻量分割线
          focus:   '#14b8a6',                   // 聚焦态边框（固定品牌色）
        },
      },

      // ── 字体栈：优先中文字体 ────────────────────────────────
      fontFamily: {
        sans: [
          '"PingFang SC"',      // macOS / iOS 中文
          '"Microsoft YaHei"',  // Windows 中文
          '"Noto Sans SC"',     // Android / Linux 中文
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"Fira Code"',
          'Consolas',
          'monospace',
        ],
      },

      // ── 阴影系统 ────────────────────────────────────────────
      boxShadow: {
        // 卡片默认阴影：轻柔，不抢眼
        'card':    '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        // 卡片 hover 阴影：稍强，给予交互反馈
        'card-md': '0 4px 12px 0 rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
        // 底部导航栏阴影：向上投影
        'nav':     '0 -1px 8px 0 rgb(0 0 0 / 0.06)',
        // 浮动按钮阴影
        'fab':     '0 4px 16px 0 rgb(14 148 132 / 0.35)',
      },

      // ── 圆角系统 ────────────────────────────────────────────
      borderRadius: {
        'xl':  '0.75rem',   // 12px：卡片
        '2xl': '1rem',      // 16px：大卡片、弹窗
        '3xl': '1.5rem',    // 24px：特大圆角
      },

      // ── 间距补充 ────────────────────────────────────────────
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)', // iOS 底部安全区
        '18': '4.5rem',  // 72px：底部导航高度预留
      },

      // ── 自定义动画 ──────────────────────────────────────────
      keyframes: {
        slideUp: {
          '0%':   { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        // AI 小票扫描线动画：从上到下扫描
        scanline: {
          '0%':   { transform: 'translateY(-100%)' },
          '50%':  { transform: 'translateY(1000%)'  },
          '100%': { transform: 'translateY(-100%)' },
        },
      },
      animation: {
        slideUp:  'slideUp 0.25s ease-out',
        scanline: 'scanline 2s ease-in-out infinite',
      },
    },
  },

  plugins: [],
}
