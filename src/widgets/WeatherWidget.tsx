// WeatherWidget — 天气展示组件（S2 阶段使用 Mock 数据）
// 接口设计已为 S6 真实 API 接入预留：props 接收数据，不在内部 fetch
// S6 时只需在父组件替换数据来源，此组件零改动

import { MOCK_WEATHER, WEATHER_META } from '@/mock/weather.mock'
import type { WeatherData } from '@/mock/weather.mock'

// ── Props 定义：数据从外部注入，组件只负责渲染 ───────────────
interface WeatherWidgetProps {
  /** 天气数据；默认使用 Mock 数据，S6 传入真实 API 返回值 */
  data?: WeatherData
  /** 刷新回调：S6 阶段接入后传入真实的重新请求函数 */
  onRefresh?: () => void
  /** 是否正在加载（真实 API 加载状态，S2 阶段永远是 false） */
  loading?: boolean
}

function WeatherWidget({
  data = MOCK_WEATHER,   // 默认使用 Mock 数据，S6 替换时从父组件传入
  onRefresh,             // 刷新回调占位，S2 阶段不实现真实逻辑
  loading = false,       // 加载状态，S2 阶段固定 false
}: WeatherWidgetProps) {

  // 从映射表中取当前天气的 emoji 和中文标签
  const { emoji, label } = WEATHER_META[data.condition]

  return (
    // 整体容器：横向布局，左右两侧信息分布
    <div className="flex items-center justify-between">

      {/* 左侧：城市 + 天气状况 ─────────────────────────────── */}
      <div className="flex items-center gap-2">

        {/* 天气 Emoji：大号展示，视觉聚焦 */}
        <span className="text-2xl leading-none" role="img" aria-label={label}>
          {emoji}
        </span>

        <div>
          {/* 城市名 + 天气标签 */}
          <p className="text-sm font-semibold text-white/90 leading-tight">
            {data.city}
            <span className="font-normal text-white/60 ml-1.5">{label}</span>
          </p>
          {/* 湿度 + 风速：次要气象信息 */}
          <p className="text-xs text-white/50 mt-0.5">
            湿度 {data.humidity}%  ·  风速 {data.windSpeed} km/h
          </p>
        </div>
      </div>

      {/* 右侧：温度信息 ─────────────────────────────────────── */}
      <div className="text-right">

        {/* 当前温度：大号主要数字 */}
        <p className="text-xl font-bold text-white/95 leading-tight">
          {data.tempCurrent}°
          {/* 加载中时显示转圈动画 */}
          {loading && (
            <span className="inline-block ml-1 text-sm animate-spin text-white/40">⟳</span>
          )}
        </p>

        {/* 最高 / 最低温度区间 */}
        <p className="text-xs text-white/50 mt-0.5">
          {data.tempLow}° ~ {data.tempHigh}°
        </p>
      </div>

      {/* 刷新按钮：仅在 onRefresh 回调存在时显示 ────────────
          S2 阶段不传 onRefresh，此按钮不渲染
          S6 阶段父组件传入真实 refresh 函数后自动出现       */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="ml-2 text-white/40 hover:text-white/70 transition-colors
                     text-lg leading-none p-1 -mr-1"
          aria-label="刷新天气"
        >
          ⟳
        </button>
      )}

    </div>
  )
}

export default WeatherWidget
