// ClockWidget — 实时数字时钟组件
// 显示：当前年月日 + 星期 + 时:分:秒
// 驱动方式：useEffect + setInterval 每秒更新一次

import { useState, useEffect } from 'react'

// ── 星期数字 → 中文映射表 ──────────────────────────────────────
const WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

// ── 时间格式化工具：补零到两位 ────────────────────────────────
const pad2 = (n: number): string => String(n).padStart(2, '0')

// ── 解析 Date 对象为所有需要的时间字段 ───────────────────────
interface TimeFields {
  year:    number   // 年份，如 2026
  month:   number   // 月份 1-12
  day:     number   // 日期 1-31
  weekday: string   // 中文星期，如"星期三"
  hours:   string   // 小时（两位）
  minutes: string   // 分钟（两位）
  seconds: string   // 秒（两位）
}

function parseTime(date: Date): TimeFields {
  return {
    year:    date.getFullYear(),
    month:   date.getMonth() + 1,          // getMonth() 从 0 开始，需 +1
    day:     date.getDate(),
    weekday: WEEKDAY_CN[date.getDay()],    // getDay() 返回 0-6，映射为中文
    hours:   pad2(date.getHours()),
    minutes: pad2(date.getMinutes()),
    seconds: pad2(date.getSeconds()),
  }
}

// ── 主组件 ────────────────────────────────────────────────────

function ClockWidget() {
  // 用 Date 对象作为 state，每次 tick 触发重渲染
  const [time, setTime] = useState<TimeFields>(() => parseTime(new Date()))

  useEffect(() => {
    // 创建定时器：每 1000ms 更新一次时间
    const timer = setInterval(() => {
      setTime(parseTime(new Date()))   // 读取最新系统时间并更新 state
    }, 1000)

    // 清理函数：组件卸载时清除定时器，避免内存泄漏
    return () => clearInterval(timer)
  }, []) // 空依赖数组：只在组件挂载时启动一次定时器

  return (
    // 整体容器：横向布局，两侧内容左右分布
    <div className="flex items-center justify-between">

      {/* 左侧：年月日 + 星期 ──────────────────────────────── */}
      <div>
        {/* 年月日：主要信息，较大字号 */}
        <p className="text-sm font-semibold text-white/90 leading-tight">
          {time.year}年{time.month}月{time.day}日
        </p>
        {/* 星期：次要信息，稍小字号 */}
        <p className="text-xs text-white/60 mt-0.5">
          {time.weekday}
        </p>
      </div>

      {/* 右侧：时:分:秒 ────────────────────────────────────── */}
      <div className="text-right">
        {/* 时分：大号加粗，数字等宽字体避免跳动 */}
        <p className="text-xl font-bold text-white/95 tracking-widest font-mono leading-tight">
          {time.hours}:{time.minutes}
        </p>
        {/* 秒：小字，透明度低，不抢焦点 */}
        <p className="text-xs text-white/50 font-mono mt-0.5 tracking-wider">
          :{time.seconds}
        </p>
      </div>

    </div>
  )
}

export default ClockWidget
