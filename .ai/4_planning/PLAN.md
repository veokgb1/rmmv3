# PLAN.md — RMMV3 S0-S9 完整执行计划

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 已完成 |
| **S1** | 基础架构 | Vite 工程、六层目录、四页面骨架 | ✅ 已完成 100% |
| **S2** | UI 增强 | Mock数据层、Clock、天气骨架 | 🔨 进行中 |
| **S3** | 数据模型 | Firestore 结构、TypeScript 类型完善 | ⏳ 待开始 |
| **S4** | 解析引擎 | 微信/支付宝 CSV 解析，错误收集 | ⏳ 待开始 |
| **S5** | 手动记账 | 表单录入、编辑、删除 | ⏳ 待开始 |
| **S6** | 统计图表 | 月度统计、分类饼图、趋势折线图 | ⏳ 待开始 |
| **S7** | 分类管理 | 自定义分类、关键词规则 | ⏳ 待开始 |
| **S8** | 数据导出 | 导出 CSV/Excel | ⏳ 待开始 |
| **S9** | 优化上线 | 性能优化、Firebase Hosting 部署 | ⏳ 待开始 |
| **SX** | 收尾增强 | **全局换皮肤 / 多主题 / 深色模式** | ⏳ 最终收尾时统一处理 |

---

## ✅ S0 — 环境初始化（已归档）
所有治理矩阵文件、`.gitignore`、Git 仓库初始化完成。

---

## ✅ S1 — 基础架构搭建（100% 完成，已归档）

- [x] `package.json` 依赖声明
- [x] `vite.config.ts` 路径别名 `@/`
- [x] `tsconfig*.json` TypeScript 严格模式
- [x] `tailwind.config.js` 主色调 + 中文字体 + darkMode class 预设
- [x] `postcss.config.js`
- [x] `index.html` 中文 lang/meta
- [x] `src/index.css` Tailwind + CSS 变量系统 + 全局组件样式库
- [x] `src/main.tsx` 入口挂载
- [x] `src/App.tsx` 路由 + 布局
- [x] `src/pages/` 四页面骨架
- [x] `src/components/layout/BottomNav.tsx`
- [x] `src/types/` Transaction + ParseResult
- [x] `src/utils/` dateUtils + numberUtils
- [x] GitHub 推送 `https://github.com/veokgb1/RMMV3`

---

## 🔨 S2 — UI 增强（进行中）

> ⚠️ **S2 铁律：严禁接入 Firebase 或任何真实 API，全部使用 Mock 数据驱动**
> 🔒 **主题换皮肤 / 深色模式切换：已冻结，挪至 SX 收尾阶段统一处理，S2 期间绝不开发**

### 2.1 Mock 数据层
- [x] `src/mock/transactions.mock.ts`：20条逼真账单数据 + 本月统计辅助函数
- [ ] `src/mock/weather.mock.ts`：模拟天气数据（WeatherWidget 使用）

### 2.2 主题系统 ← 🔒 冻结，移至 SX
- ~~`src/store/themeStore.ts`~~（SX 阶段实现）
- ~~深色模式切换 UI~~（SX 阶段实现）

### 2.3 Clock 模块 ← ⏳ 当前任务
- [ ] `src/widgets/ClockWidget.tsx`：实时时钟（年月日 + 星期 + 时间）
- [ ] 嵌入 `HomePage.tsx` 顶部区域

### 2.4 天气组件骨架 ← ⏳ 下一任务
- [ ] `src/mock/weather.mock.ts`：静态天气数据
- [ ] `src/widgets/WeatherWidget.tsx`：天气展示骨架，预留真实 API 接口
- [ ] 嵌入 `HomePage.tsx` 顶部区域

### 2.5 S2 完成后待归档项
- [x] 首页精美化（Mock 数据驱动）
- [x] 设计系统色板升级（tailwind.config.js）
- [x] CSS 变量系统 + 组件样式库（index.css）

---

## SX — 收尾增强（最终阶段，统一处理）

> 📌 **备忘**：等待 S3-S9 核心功能全部完成后，再统一处理以下体验增强：

- [ ] 全局换皮肤功能（`src/store/themeStore.ts`）
- [ ] 深色模式切换（暗色变量覆盖，`html.dark` 切换）
- [ ] 多色系主题支持（可选：绿/蓝/紫色系）
- [ ] 字体大小切换（紧凑/标准/宽松三档）
- [ ] 图片缩放弹窗 Lightbox

---

## S3-S9
详细任务在对应阶段开始前展开。
