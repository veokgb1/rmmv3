// 查询页：账单列表、搜索与多维度筛选
// 对应路由：/query

/**
 * 查询页组件
 * 职责（S1 阶段为占位骨架，S4/S5 阶段接入真实数据）：
 *  - 搜索栏：按关键词搜索账单描述
 *  - 筛选栏：按分类、时间范围、收支方向筛选
 *  - 账单列表：展示符合条件的账单记录
 */
function QueryPage() {
  return (
    // 页面容器
    <div className="p-4 space-y-4">

      {/* ── 页面标题 ── */}
      <div className="pt-2">
        <h1 className="text-xl font-bold text-gray-900">账单查询</h1>
        <p className="text-xs text-gray-400 mt-1">搜索和筛选你的全部账单记录</p>
      </div>

      {/* ── 搜索栏（S4 阶段实现搜索逻辑） ── */}
      <div className="relative">
        {/* 搜索图标 */}
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
          🔍
        </span>
        {/* 搜索输入框 */}
        <input
          type="text"
          placeholder="搜索商家名称、备注..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl
                     text-sm text-gray-700 placeholder-gray-300
                     focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          disabled // S1 阶段暂时禁用，S4 接入数据后启用
        />
      </div>

      {/* ── 快速筛选标签（S4 阶段实现） ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {/* 筛选标签：当月 */}
        <button className="flex-shrink-0 px-3 py-1 bg-primary-500 text-white text-xs rounded-full">
          本月
        </button>
        {/* 筛选标签：仅支出 */}
        <button className="flex-shrink-0 px-3 py-1 bg-white border border-gray-200 text-gray-600 text-xs rounded-full">
          仅支出
        </button>
        {/* 筛选标签：仅收入 */}
        <button className="flex-shrink-0 px-3 py-1 bg-white border border-gray-200 text-gray-600 text-xs rounded-full">
          仅收入
        </button>
        {/* 筛选标签：餐饮 */}
        <button className="flex-shrink-0 px-3 py-1 bg-white border border-gray-200 text-gray-600 text-xs rounded-full">
          餐饮
        </button>
        {/* 筛选标签：交通 */}
        <button className="flex-shrink-0 px-3 py-1 bg-white border border-gray-200 text-gray-600 text-xs rounded-full">
          交通
        </button>
      </div>

      {/* ── 账单列表占位区 ── */}
      <div className="card">
        {/* S4 完成后替换为 BillList 组件 */}
        <div className="py-12 text-center text-gray-300">
          <p className="text-4xl mb-3">🗂️</p>
          <p className="text-sm text-gray-400">暂无账单记录</p>
          <p className="text-xs text-gray-300 mt-1">账单导入后将在此显示</p>
        </div>
      </div>

    </div>
  )
}

// 导出查询页组件供路由使用
export default QueryPage
