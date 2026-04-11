// 底部导航栏：移动端主导航，固定在屏幕底部
// 属于第二层 components/layout，负责全局导航 UI

import { NavLink }    from 'react-router-dom'
import { useMemo }    from 'react'
import { useBills }   from '@/hooks/useBills'

// 导航项的数据结构定义
type NavItem = {
  path:       string    // 路由路径
  icon:       string    // 图标（使用 emoji 作为占位，S1 后期替换为 SVG 图标）
  label:      string    // 显示文字
  /** 是否显示红点徽章（true = 有待处理事项）*/
  showBadge?: boolean
}

// ─── 治理中心冲突数量检测（同步 detectConflicts 逻辑）─────────────
// 只检测是否存在冲突（不计数），用于驱动导航徽章
function useHasGovernanceConflicts(): boolean {
  const { allLedgerBills } = useBills()
  return useMemo(() => {
    return allLedgerBills.some(tx => {
      if (tx.status === 'void') return false
      const isMigrated = tx.rawData?.['_migratedFromV2'] === true
      return (
        tx.isDuplicate === true ||
        (isMigrated && tx.isVerified !== true)
      )
    })
  }, [allLedgerBills])
}

/**
 * BottomNav 底部导航栏组件
 * 使用 NavLink 实现路由高亮：当前路由自动加上 active 样式
 * 固定在屏幕底部，高度约 56px，有顶部分割线
 * S21：治理中心条目带冲突红点徽章
 */
function BottomNav() {
  const hasConflicts = useHasGovernanceConflicts()

  // 底部导航菜单配置（运行时合并冲突状态）
  const NAV_ITEMS: NavItem[] = [
    { path: '/home',       icon: '🏠', label: '首页'   },
    { path: '/query',      icon: '🔍', label: '查询'   },
    { path: '/report',     icon: '📊', label: '报表'   },
    { path: '/governance', icon: '🛡️', label: '治理',  showBadge: hasConflicts },
    { path: '/settings',   icon: '⚙️', label: '设置'   },
  ]

  return (
    // 固定定位：始终在屏幕底部，z-50 避免被内容遮挡
    <nav className="fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-gray-100
                    flex items-stretch z-50 shadow-[0_-1px_8px_rgba(0,0,0,0.06)]">

      {/* 循环渲染每个导航项 */}
      {NAV_ITEMS.map(({ path, icon, label, showBadge }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            [
              'flex-1 flex flex-col items-center justify-center transition-colors relative',
              isActive
                ? 'text-primary-600'
                : 'text-gray-400 hover:text-gray-500',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              {/* 激活指示线（顶部细条）*/}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2
                                 w-8 h-0.5 rounded-full bg-primary-500" />
              )}

              {/* 图标容器：激活时背景药丸 */}
              <span className={[
                'relative flex items-center justify-center rounded-xl transition-all',
                isActive
                  ? 'bg-primary-50 px-3 py-0.5 -mt-0.5'
                  : 'px-3 py-0.5',
              ].join(' ')}>
                <span className={[
                  'leading-none transition-all',
                  isActive ? 'text-xl' : 'text-lg',
                ].join(' ')}>
                  {icon}
                </span>
                {/* 红点徽章 */}
                {showBadge && (
                  <span className="absolute -top-0.5 -right-0 w-2 h-2 rounded-full bg-red-500" />
                )}
              </span>

              {/* 导航文字标签 */}
              <span className={[
                'transition-all leading-none mt-0.5',
                isActive
                  ? 'text-[11px] font-bold text-primary-600'
                  : 'text-[10px] font-medium text-gray-400',
              ].join(' ')}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}

    </nav>
  )
}

// 导出底部导航组件供 App.tsx 使用
export default BottomNav
