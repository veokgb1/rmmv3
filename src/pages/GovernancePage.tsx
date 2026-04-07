// 治理页面 — S21
// 包裹 ConflictCenter，提供页面级 padding 与安全区适配
// 路由：/governance（由 App.tsx 注册，BottomNav 第五项入口）

import ConflictCenter from '@/features/governance/ConflictCenter'

export default function GovernancePage() {
  return (
    <div className="min-h-full bg-surface-primary">
      <ConflictCenter />
    </div>
  )
}
