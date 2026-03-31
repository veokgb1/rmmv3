// Vite 构建工具配置文件
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(), // 启用 React 支持（JSX 转换、Fast Refresh）
  ],
  resolve: {
    alias: {
      // 配置路径别名：@ 指向 src 目录，避免深层相对路径 ../../
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000, // 开发服务器端口固定为 3000
    open: true, // 启动后自动打开浏览器
  },
})
