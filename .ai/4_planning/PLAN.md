# PLAN.md — RMMV3 S0-S9 完整执行计划

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 已完成 |
| **S1** | 基础架构 | Vite 工程、六层目录、四页面骨架 | ✅ 已完成 100% |
| **S2** | UI 增强 | 主题切换、字体切换、弹窗、Clock、天气骨架 | ⏳ 等待启动 |
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

## ✅ S1 — 基础架构搭建（100% 完成，已归档）

- [x] `package.json` 依赖声明
- [x] `vite.config.ts` 路径别名 `@/`
- [x] `tsconfig*.json` TypeScript 严格模式
- [x] `tailwind.config.js` 主色调 + 中文字体
- [x] `postcss.config.js`
- [x] `index.html` 中文 lang/meta
- [x] `src/index.css` Tailwind + 全局样式
- [x] `src/main.tsx` 入口挂载
- [x] `src/App.tsx` 路由 + 布局
- [x] `src/pages/` 四页面骨架（Home / Query / Report / Settings）
- [x] `src/components/layout/BottomNav.tsx` NavLink 激活高亮
- [x] `src/types/` Transaction + ParseResult 类型定义
- [x] `src/utils/` dateUtils + numberUtils 工具函数
- [x] 六层目录结构建立（hooks / services / store / utils / types）
- [x] `tsc --noEmit` 零错误
- [x] `vite build` 成功（1.09s）
- [x] Git Commit `c40c475`
- [x] **GitHub 推送成功** → `https://github.com/veokgb1/RMMV3`（main 分支）

---

## ⏳ S2 — UI 增强（等待启动）

> ⚠️ **S2 铁律：严禁接入 Firebase 或任何真实 API，全部使用 Mock 数据驱动**

### 2.1 Mock 数据层
- [ ] 创建 `src/mock/` 目录
- [ ] `src/mock/transactions.mock.ts`：20条模拟账单（覆盖各分类）
- [ ] `src/mock/stats.mock.ts`：模拟月度统计数据
- [ ] `src/mock/weather.mock.ts`：模拟天气数据
- [ ] `src/config/env.ts`：Feature Flag（`USE_MOCK_DATA` 开关）

### 2.2 主题系统（Theme）
- [ ] `src/store/themeStore.ts`（Zustand，持久化 localStorage）
- [ ] 三种模式：`light` / `dark` / `system`
- [ ] `tailwind.config.js` 启用 `darkMode: 'class'`
- [ ] `src/index.css` CSS 变量（`--color-bg`、`--color-text` 等）
- [ ] `SettingsPage.tsx` 接入主题切换 UI

### 2.3 字体大小切换
- [ ] `themeStore.ts` 增加 `fontSize: 'compact' | 'normal' | 'large'`
- [ ] `index.css` 三档字体尺寸 CSS 变量
- [ ] `SettingsPage.tsx` 接入字体切换 UI

### 2.4 图片缩放弹窗（Lightbox）
- [ ] `src/components/common/Lightbox.tsx`
- [ ] 支持：点击图片 → 全屏 → 点击背景/ESC 关闭

### 2.5 Clock 模块
- [ ] `src/components/widgets/ClockWidget.tsx`
- [ ] 实时时钟（useEffect + setInterval），嵌入 HomePage

### 2.6 天气组件骨架
- [ ] `src/components/widgets/WeatherWidget.tsx`
- [ ] 使用 `weather.mock.ts` 静态数据渲染，预留 `onRefresh` 接口

---

## S3-S9
详细任务在对应阶段开始前展开。
