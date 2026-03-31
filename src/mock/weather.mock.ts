// Mock 天气数据
// S2 阶段 WeatherWidget 使用此静态数据，S6 阶段替换为真实 API 调用

// ── 天气状况类型 ──────────────────────────────────────────────

/** 天气状况枚举（与真实 API 对齐，S6 替换时直接复用） */
export type WeatherCondition =
  | 'sunny'        // 晴天
  | 'partly-cloudy'// 多云
  | 'cloudy'       // 阴天
  | 'rainy'        // 小雨
  | 'heavy-rain'   // 大雨
  | 'snowy'        // 雪
  | 'foggy'        // 雾霾
  | 'thunderstorm' // 雷阵雨

/** 单个城市的天气数据结构（与 OpenWeatherMap / 和风天气 API 对齐） */
export interface WeatherData {
  city:        string            // 城市名（中文）
  country:     string            // 国家/地区代码
  condition:   WeatherCondition  // 天气状况
  tempCurrent: number            // 当前温度（摄氏度）
  tempHigh:    number            // 今日最高温
  tempLow:     number            // 今日最低温
  humidity:    number            // 相对湿度（百分比）
  windSpeed:   number            // 风速（km/h）
  feelsLike:   number            // 体感温度（摄氏度）
  updatedAt:   string            // 数据更新时间（ISO 字符串）
}

// ── 天气状况 → Emoji + 中文标签映射 ─────────────────────────

export const WEATHER_META: Record<WeatherCondition, { emoji: string; label: string }> = {
  'sunny':         { emoji: '☀️',  label: '晴'     },
  'partly-cloudy': { emoji: '⛅',  label: '多云'   },
  'cloudy':        { emoji: '☁️',  label: '阴'     },
  'rainy':         { emoji: '🌧️', label: '小雨'   },
  'heavy-rain':    { emoji: '⛈️', label: '暴雨'   },
  'snowy':         { emoji: '❄️',  label: '雪'     },
  'foggy':         { emoji: '🌫️', label: '雾霾'   },
  'thunderstorm':  { emoji: '🌩️', label: '雷阵雨' },
}

// ── 静态 Mock 数据（模拟大阪当前天气） ───────────────────────

export const MOCK_WEATHER: WeatherData = {
  city:        '大阪',
  country:     'JP',
  condition:   'partly-cloudy',     // 天气状况：多云
  tempCurrent: 22,                   // 当前温度 22°C
  tempHigh:    26,                   // 最高 26°C
  tempLow:     16,                   // 最低 16°C
  humidity:    58,                   // 湿度 58%
  windSpeed:   12,                   // 风速 12 km/h
  feelsLike:   21,                   // 体感 21°C
  updatedAt:   new Date().toISOString(), // 使用当前时间模拟"刚刚更新"
}
