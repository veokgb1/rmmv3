# PLAN.md — RMMV3 S0-S9 完整执行计划

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 已完成 |
| **S1** | 基础架构 | Vite 工程、六层目录、四页面骨架 | ✅ 已完成 |
| **S2** | UI 增强 | 主题切换、字体切换、弹窗、Clock、天气骨架 | ⏳ 当前阶段 |
| **S3** | 数据模型 | Firestore 结构、TypeScript 类型完善 | ⏳ 待开始 |
| **S4** | 解析引擎 | 微信/支付宝 CSV 解析，错误收集 | ⏳ 待开始 |
| **S5** | 手动记账 | 表单录入、编辑、删除 | ⏳ 待开始 |
| **S6** | 统计图表 | 月度统计、分类饼图、趋势折线图 | ⏳ 待开始 |
| **S7** | 分类管理 | 自定义分类、关键词规则 | ⏳ 待开始 |
| **S8** | 数据导出 | 导出 CSV/Excel | ⏳ 待开始 |
| **S9** | 优化上线 | 性能优化、Firebase Hosting 部署 | ⏳ 待开始 |

---

## ✅ S0 — 环境初始化（已归档）
所有治理矩阵文件、`.gitignore`、Git 仓库初始化完成。

---

## ✅ S1 — 基础架构搭建（已归档，全部勾选）

- [x] `package.json` 依赖声明
- [x] `vite.config.ts` 路径别名 `@/`
- [x] `tsconfig*.json` TypeScript 严格模式
- [x] `tailwind.config.js` 主色调 + 中文字体
- [x] `postcss.config.js`
- [x] `index.html` 中文 lang/meta
- [x] `src/index.css` Tailwind + 全局样式
- [x] `src/main.tsx` 入口挂载
- [x] `src/App.tsx` 路由 + 布局
- [x] `src/pages/` 四页面骨架
- [x] `src/components/layout/BottomNav.tsx`
- [x] `src/types/` Transaction + ParseResult 类型
- [x] `src/utils/` dateUtils + numberUtils
- [x] 六层目录结构建立
- [x] `tsc --noEmit` 零错误
- [x] `vite build` 成功（1.09s）
- [x] Git Commit `c40c475`
- [ ] GitHub 推送（等待 `veokgb1/RMMV3` 仓库创建后执行）

---

## ⏳ S2 — UI 增强（当前阶段）

**约束**：禁止接入 Firebase 或任何真实 API

### 2.1 Mock 数据层
- [ ] 创建 `src/mock/` 目录
- [ ] `src/mock/transactions.mock.ts`：20条模拟账单数据
- [ ] `src/mock/stats.mock.ts`：模拟月度统计数据
- [ ] `src/mock/weather.mock.ts`：模拟天气数据

### 2.2 主题系统（Theme）
- [ ] 创建 `src/store/themeStore.ts`（Zustand，持久化到 localStorage）
- [ ] 支持三种模式：`light`（浅色）/ `dark`（深色）/ `system`（跟随系统）
- [ ] 更新 `tailwind.config.js`：启用 `darkMode: 'class'`
- [ ] 更新 `src/index.css`：定义 CSS 变量（`--color-bg`、`--color-text` 等）
- [ ] 在 `SettingsPage.tsx` 中接入主题切换 UI

### 2.3 字体大小切换
- [ ] 在 `themeStore.ts` 中增加 `fontSize: 'compact' | 'normal' | 'large'`
- [ ] 在 `index.css` 中定义三档字体尺寸 CSS 变量
- [ ] 在 `SettingsPage.tsx` 中接入字体切换 UI

### 2.4 图片缩放弹窗（Lightbox）
- [ ] 创建 `src/components/common/Lightbox.tsx`
- [ ] 支持：点击图片 → 全屏展示 → 点击背景关闭 → ESC 关闭

### 2.5 Clock 模块
- [ ] 创建 `src/components/widgets/ClockWidget.tsx`
- [ ] 功能：实时显示当前时间（useEffect + setInterval）
- [ ] 在 `HomePage.tsx` 中嵌入

### 2.6 天气组件骨架
- [ ] 创建 `src/components/widgets/WeatherWidget.tsx`
- [ ] 使用 `src/mock/weather.mock.ts` 中的静态数据渲染
- [ ] 预留 `onRefresh` 回调接口，S3 之后接入真实 API

---

## S3-S9
详细任务在对应阶段开始前展开。
