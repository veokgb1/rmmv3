// Tailwind CSS 配置文件
/** @type {import('tailwindcss').Config} */
export default {
  // 扫描范围：告诉 Tailwind 在哪些文件中查找用到的 class，用于 tree-shaking
  content: [
    './index.html',          // 根 HTML 文件
    './src/**/*.{ts,tsx}',   // src 目录下所有 TypeScript 和 TSX 文件
  ],
  theme: {
    extend: {
      // 自定义主题扩展区域（后续按需添加品牌色、字体等）
      colors: {
        // 主色调：深蓝绿，用于主要操作按钮和导航
        primary: {
          50:  '#f0fdf9',
          100: '#ccfbef',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
        },
        // 辅助色：收入绿
        income: '#22c55e',
        // 辅助色：支出红
        expense: '#ef4444',
      },
      fontFamily: {
        // 中文字体优先顺序
        sans: ['"PingFang SC"', '"Microsoft YaHei"', '"Helvetica Neue"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
