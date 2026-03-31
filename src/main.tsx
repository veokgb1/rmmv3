// 应用程序入口文件：挂载 React 根组件到 DOM
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 引入全局样式（包含 Tailwind CSS 的三条核心指令）
import './index.css'

// 引入根组件（包含路由配置）
import App from './App'

// 获取 HTML 中 id="root" 的挂载节点
const rootElement = document.getElementById('root')

// 安全检查：如果挂载节点不存在，抛出明确错误，避免静默失败
if (!rootElement) {
  throw new Error('找不到 id="root" 的挂载节点，请检查 index.html 是否正确')
}

// 创建 React 根节点并渲染，StrictMode 会在开发环境暴露潜在问题
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
