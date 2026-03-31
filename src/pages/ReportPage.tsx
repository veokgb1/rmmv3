// 报表页：月度收支统计、分类占比分析
// 对应路由：/report

/**
 * 报表页组件
 * 职责（S1 阶段为占位骨架，S6 阶段接入图表库和真实数据）：
 *  - 月度收支趋势折线图
 *  - 支出分类占比饼图
 *  - 各分类支出金额排行
 */
function ReportPage() {
  return (
    // 页面容器
    <div className="p-4 space-y-4">

      {/* ── 页面标题 ── */}
      <div className="pt-2">
        <h1 className="text-xl font-bold text-gray-900">财务报表</h1>
        <p className="text-xs text-gray-400 mt-1">可视化你的收支结构与趋势</p>
      </div>

      {/* ── 月份切换标签栏（S6 阶段实现） ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {/* 近三个月的月份标签 */}
        {['1月', '2月', '3月'].map((month, index) => (
          <button
            key={month}
            // 最后一项（本月）默认选中高亮
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              index === 2
                ? 'bg-white text-primary-600 shadow-sm' // 当前选中状态
                : 'text-gray-500 hover:text-gray-700'   // 未选中状态
            }`}
          >
            {month}
          </button>
        ))}
      </div>

      {/* ── 月度趋势图占位（S6 阶段接入 Recharts） ── */}
      <div className="card">
        <p className="text-sm font-medium text-gray-700 mb-1">月度收支趋势</p>
        <p className="text-xs text-gray-400 mb-4">近12个月收入与支出对比</p>
        {/* 图表占位区域 */}
        <div className="h-40 bg-gray-50 rounded-lg flex items-center justify-center border border-dashed border-gray-200">
          <div className="text-center text-gray-300">
            <p className="text-3xl mb-1">📈</p>
            <p className="text-xs">图表将在 S6 阶段接入</p>
          </div>
        </div>
      </div>

      {/* ── 支出分类占比占位（S6 阶段接入饼图） ── */}
      <div className="card">
        <p className="text-sm font-medium text-gray-700 mb-1">支出分类占比</p>
        <p className="text-xs text-gray-400 mb-4">本月各类别支出比例</p>
        {/* 饼图占位区域 */}
        <div className="h-40 bg-gray-50 rounded-lg flex items-center justify-center border border-dashed border-gray-200">
          <div className="text-center text-gray-300">
            <p className="text-3xl mb-1">🥧</p>
            <p className="text-xs">图表将在 S6 阶段接入</p>
          </div>
        </div>
      </div>

      {/* ── 分类排行占位（S6 阶段实现） ── */}
      <div className="card">
        <p className="text-sm font-medium text-gray-700 mb-3">分类支出排行</p>
        {/* 用占位条目模拟最终样式 */}
        {['餐饮', '交通', '购物', '娱乐'].map((category) => (
          <div key={category} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
            <span className="text-sm text-gray-600 w-10">{category}</span>
            {/* 进度条占位 */}
            <div className="flex-1 h-2 bg-gray-100 rounded-full">
              <div className="h-2 bg-gray-200 rounded-full w-1/3" />
            </div>
            {/* 金额占位 */}
            <span className="text-sm text-gray-300 w-12 text-right">¥ --</span>
          </div>
        ))}
      </div>

    </div>
  )
}

// 导出报表页组件供路由使用
export default ReportPage
