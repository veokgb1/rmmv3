// 首页：账单总览、本月收支摘要、快速记账入口
// 对应路由：/home

/**
 * 首页组件
 * 职责（S1 阶段为占位骨架，S3/S5 阶段接入真实数据）：
 *  - 展示本月收支摘要卡片
 *  - 展示最近账单列表入口
 *  - 提供快速记账的浮动按钮入口
 */
function HomePage() {
  return (
    // 页面容器：纵向滚动，内边距保持与设计稿一致
    <div className="p-4 space-y-4">

      {/* ── 页面顶部标题栏 ── */}
      <div className="flex items-center justify-between pt-2">
        {/* 应用名称 */}
        <h1 className="text-xl font-bold text-gray-900">资金总览</h1>
        {/* 月份切换按钮（S6 阶段实现） */}
        <button className="text-sm text-primary-600 font-medium">
          2026年3月 ▾
        </button>
      </div>

      {/* ── 本月收支摘要卡片 ── */}
      <div className="card">
        {/* 卡片标题 */}
        <p className="text-xs text-gray-400 mb-3">本月概览</p>

        {/* 三栏布局：收入 / 支出 / 净收支 */}
        <div className="grid grid-cols-3 gap-2 text-center">

          {/* 收入栏 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">收入</p>
            {/* 占位数字，S3 接入数据后替换 */}
            <p className="text-lg font-bold text-income">¥ --</p>
          </div>

          {/* 支出栏 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">支出</p>
            <p className="text-lg font-bold text-expense">¥ --</p>
          </div>

          {/* 净收支栏 */}
          <div>
            <p className="text-xs text-gray-400 mb-1">净收支</p>
            <p className="text-lg font-bold text-gray-700">¥ --</p>
          </div>
        </div>
      </div>

      {/* ── 快捷操作入口 ── */}
      <div className="grid grid-cols-2 gap-3">

        {/* 导入账单入口（S4 阶段实现） */}
        <button className="card flex flex-col items-center py-4 gap-2 hover:shadow-md transition-shadow">
          <span className="text-2xl">📥</span>
          <span className="text-sm font-medium text-gray-700">导入账单</span>
          <span className="text-xs text-gray-400">微信 / 支付宝</span>
        </button>

        {/* 手动记账入口（S5 阶段实现） */}
        <button className="card flex flex-col items-center py-4 gap-2 hover:shadow-md transition-shadow">
          <span className="text-2xl">✏️</span>
          <span className="text-sm font-medium text-gray-700">手动记账</span>
          <span className="text-xs text-gray-400">快速录入一笔</span>
        </button>
      </div>

      {/* ── 最近账单占位区域 ── */}
      <div className="card">
        <p className="text-sm font-medium text-gray-700 mb-3">最近账单</p>
        {/* S4 完成后替换为真实账单列表组件 */}
        <div className="py-8 text-center text-gray-300">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">暂无账单数据</p>
          <p className="text-xs mt-1">导入账单或手动记账后显示</p>
        </div>
      </div>

    </div>
  )
}

// 导出首页组件供路由使用
export default HomePage
