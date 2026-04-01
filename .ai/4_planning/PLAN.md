# PLAN.md — RMMV3 S0-S9 + 战略扩展计划

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 封板 |
| **S1** | 基础架构 | Vite 工程、六层目录、四页面骨架 | ✅ 封板 |
| **S2** | UI 增强 | Mock数据、Clock、天气、首页精美化 | ✅ 封板 |
| **S3** | 数据模型 | Firestore Schema、类型体系（ledgerId预留） | ✅ 封板 |
| **S4** | 解析引擎 | CSV解析器、ImportModal、三大战略字段注入 | ✅ 封板 |
| **S5** | Firebase 接入 | 用户认证 + 账单写入 Firestore | ⏳ 等待 Firebase Config |
| **S6** | 统计图表 | 月度趋势、分类饼图、OCR核对UI | ⏳ 待开始 |
| **S7** | 权限与多账套 | 账套切换UI、RBAC、溯及既往修正 | ⏳ 待开始 |
| **S8** | 数据导出 | 按账套导出 CSV/Excel | ⏳ 待开始 |
| **S9** | 优化上线 | 性能优化、Firebase Hosting | ⏳ 待开始 |
| **SX** | 收尾增强 | 换皮肤 / 模型中控台 / OCR强化 | ⏳ 最终收尾 |

---

## ✅ S4 — 解析引擎（封板归档）

### S4 战略升级内容
- [x] `Account.types.ts`：资金账户类型 + `guessAccountId` 自动推断
- [x] `Transaction.types.ts`：注入三大战略支柱字段
  - `tags: string[]` — 多维标签
  - `accountId: string` — 资金账户
  - `sourceType: SourceType` — 录入方式
  - `originalParsedData` — AI/解析器首次输出存档
  - `isManuallyEdited` — 人工修正标记
  - `ocrStatus / ocrConfidence / ocrDoubtSpans` — OCR 工作流字段
  - `CorrectionPolicy / CorrectionIntent` — 溯及既往决策类型
- [x] `wechatParser.ts`：填充 tags/accountId/sourceType/originalParsedData
- [x] `alipayParser.ts`：同上
- [x] `ImportModal.tsx`：粘贴→解析→预览三阶段弹窗

---

## ⏳ S5 — Firebase 接入（等待 Config）

> 阻塞项：需开发者提供 Firebase `firebaseConfig` 对象

- [ ] `src/4_services/firebase/firebaseApp.ts`：SDK 单例初始化
- [ ] `src/4_services/firebase/authService.ts`：登录/注册/登出
- [ ] `src/4_services/firebase/billService.ts`：Transaction CRUD（含 ledgerId 注入）
- [ ] `src/3_hooks/useAuth.ts`：认证状态 Hook
- [ ] `src/3_hooks/useBills.ts`：账单数据 Hook（替换 Mock 数据）
- [ ] `src/5_store/authStore.ts`：Zustand 用户状态
- [ ] `src/1_pages/LoginPage.tsx`：登录/注册页面
- [ ] `ImportModal` 的"确认导入"按钮真正入库

---

## ⏳ S6 — 统计图表 + OCR 核对 UI

### 6.1 统计图表
- [ ] 安装 Recharts：`npm install recharts`
- [ ] `MonthlyBarChart.tsx`：月度收支柱状图
- [ ] `CategoryPieChart.tsx`：分类占比饼图
- [ ] 接入 WeatherWidget 真实 API

### 6.2 OCR 手写体 UI（战略支柱②）
> 设计原则：**差异留痕 + 人工校对流**

- [ ] `OcrReviewPage.tsx`：待核对账单列表（按 ocrStatus='reviewing' 筛选）
- [ ] `OcrDoubtHighlight.tsx`：存疑字段高亮组件（黄色底纹）
  - 将 `ocrDoubtSpans` 中 confidence < 0.85 的字段渲染为黄色背景
  - 点击高亮字段 → 弹出原图切片（`imageSlice` Base64）与 AI 识别对比
- [ ] `OcrImageSliceModal.tsx`：原图切片对比弹窗
  - 左：原图切片（高清）  右：AI 识别文字 + 建议修正值
  - 底部操作：确认 / 手动输入 / 标记为无法识别
- [ ] 核对完成后批量写入，ocrStatus 改为 'confirmed'

---

## ⏳ S7 — 权限与多账套（Multi-Ledger）

> 战略备忘：账套 ID 已在 S3 预留，S7 实现完整切换 UI 和权限体系

### 7.1 账套管理
- [ ] `LedgerSwitcher.tsx`：顶部导航账套切换下拉框
- [ ] `src/5_store/ledgerStore.ts`：当前活跃账套状态（Zustand）
- [ ] `LedgerSettingsPage.tsx`：账套设置（名称/货币/成员管理）

### 7.2 权限体系（RBAC）
- [ ] `firestore.rules`：基于 ledgerId + role 的读写规则
- [ ] owner/admin/editor/viewer 四级角色实现

### 7.3 溯及既往修正（战略支柱①）
> 当用户修改分类/标签时，系统弹出三选一决策弹窗：

- [ ] `CorrectionPolicyModal.tsx`：决策弹窗
  - 选项 A：**仅本条** — 只改当前这条记录
  - 选项 B：**规则前向** — 新建规则，未来相似记录自动应用
  - 选项 C：**溯及既往** — 同时修改历史上所有相似记录（需二次确认）
- [ ] `src/4_services/firebase/correctionService.ts`：执行修正逻辑
- [ ] Firestore 安全规则支持批量更新权限校验

### 7.4 多账套已知账套初始化
```
ledgers/personal        → 个人日常账本
ledgers/ledger-elderly  → 特定老年人账本
ledgers/mingpao-ca      → Ming Pao Canada
ledgers/mingpao-to      → Ming Pao Toronto
```

---

## ⏳ S8 — 数据导出

- [ ] 按当前活跃账套 + 日期范围筛选导出
- [ ] 支持 CSV / Excel 格式

---

## ⏳ S9 — 优化上线

- [ ] 懒加载与代码分割
- [ ] Firebase Hosting 部署
- [ ] PWA 配置（可选）

---

## SX — 收尾增强阶段

### SX.1 全局换皮肤（冻结，最终实现）
- [ ] `src/5_store/themeStore.ts`：深色/浅色/跟随系统
- [ ] CSS 变量切换，多色系主题

### SX.2 模型中控台（战略支柱③：AI 多厂商适配）

> 设计目标：支持从 Gemini 动态切换到 DeepSeek、MiniMax 等模型

- [ ] **前端设置页**（`SettingsPage.tsx` → "AI 模型" 分组）
  - 模型提供商列表（Gemini / DeepSeek / MiniMax / Claude / 自定义端点）
  - 每个提供商的 API Key 输入框（加密存储于 Firestore）
  - 当前激活模型指示器
  - 请求统计（用量/费用估算）

- [ ] **AI Service 适配层**（`src/4_services/ai/`）
  - `aiService.ts`：统一调用接口（屏蔽各厂商 SDK 差异）
  - `adapters/geminiAdapter.ts`
  - `adapters/deepseekAdapter.ts`
  - `adapters/minimaxAdapter.ts`
  - `adapters/openaiAdapter.ts`（兼容 OpenAI 协议的通用适配器）

- [ ] **模型记忆功能**
  - 每个账套可绑定不同的默认模型（如 mingpao-ca 用企业级模型）
  - 切换记录存储于 Firestore `users/{uid}/modelPreferences`

### SX.3 字体大小切换
- [ ] 紧凑/标准/宽松三档

### SX.4 Lightbox 图片弹窗
