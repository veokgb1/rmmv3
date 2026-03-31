// 设置页：用户偏好、分类管理、数据管理
// 对应路由：/settings

/**
 * 设置页组件
 * 职责（S1 阶段为占位骨架，各功能在对应阶段实现）：
 *  - 用户账户信息（S2 阶段接入 Firebase Auth）
 *  - 分类管理入口（S7 阶段实现）
 *  - 数据导出入口（S8 阶段实现）
 *  - 关于与版本信息
 */

// 设置分组的数据结构定义（内联 type，S3 阶段迁移到 types 目录）
type SettingItem = {
  icon: string     // 图标 emoji
  label: string    // 显示名称
  desc: string     // 描述文字
  badge?: string   // 可选徽标（如"即将支持"）
}

// 设置菜单列表数据：便于后续扩展，不要把数据写死在 JSX 里
const SETTING_GROUPS: { title: string; items: SettingItem[] }[] = [
  {
    title: '账户',
    items: [
      { icon: '👤', label: '账户信息', desc: '查看和修改个人信息', badge: 'S2' },
      { icon: '🔒', label: '账户安全', desc: '密码与登录管理', badge: 'S2' },
    ],
  },
  {
    title: '数据管理',
    items: [
      { icon: '🏷️', label: '分类管理', desc: '自定义账单分类与关键词', badge: 'S7' },
      { icon: '📤', label: '导出数据', desc: '导出为 CSV / Excel 文件', badge: 'S8' },
      { icon: '🗑️', label: '清除数据', desc: '删除全部本地账单数据' },
    ],
  },
  {
    title: '关于',
    items: [
      { icon: '📋', label: '使用说明', desc: '查看功能介绍与操作指南' },
      { icon: 'ℹ️', label: '版本信息', desc: 'RMM V3 · 0.1.0-alpha' },
    ],
  },
]

function SettingsPage() {
  return (
    // 页面容器
    <div className="p-4 space-y-5">

      {/* ── 页面标题 ── */}
      <div className="pt-2">
        <h1 className="text-xl font-bold text-gray-900">设置</h1>
      </div>

      {/* ── 用户信息卡片占位（S2 阶段替换为真实用户数据） ── */}
      <div className="card flex items-center gap-3">
        {/* 用户头像占位 */}
        <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-2xl">
          👤
        </div>
        <div>
          {/* 未登录状态提示 */}
          <p className="text-sm font-medium text-gray-700">未登录</p>
          <p className="text-xs text-primary-600 mt-0.5">点击登录 / 注册账号 →</p>
        </div>
      </div>

      {/* ── 设置菜单分组（循环渲染） ── */}
      {SETTING_GROUPS.map((group) => (
        <div key={group.title}>
          {/* 分组标题 */}
          <p className="text-xs font-medium text-gray-400 mb-2 px-1">{group.title}</p>

          {/* 分组卡片容器 */}
          <div className="card divide-y divide-gray-50 p-0 overflow-hidden">
            {group.items.map((item) => (
              // 每一行设置项
              <button
                key={item.label}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                {/* 图标 */}
                <span className="text-lg w-6 text-center">{item.icon}</span>

                {/* 文字区域：标签 + 描述 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{item.label}</p>
                  <p className="text-xs text-gray-400 truncate">{item.desc}</p>
                </div>

                {/* 右侧：阶段徽标 或 箭头 */}
                {item.badge ? (
                  // 显示开发阶段标记（S2/S7/S8 等）
                  <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                ) : (
                  // 普通箭头指示符
                  <span className="text-gray-300 text-sm">›</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

    </div>
  )
}

// 导出设置页组件供路由使用
export default SettingsPage
