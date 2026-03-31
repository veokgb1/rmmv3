# PLAN.md — RMMV3 S0-S9 完整执行计划
> 每完成一个阶段，同步更新 SESSION.md 的状态。

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 依赖 | 状态 |
|------|------|----------|------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | — | ✅ 已完成 |
| **S1** | 基础架构 | Vite 项目、六层目录、Firebase SDK | Firebase 配置 | ⏳ 待开始 |
| **S2** | 用户认证 | 登录/注册页面、路由守卫、Auth Hook | S1 | ⏳ 待开始 |
| **S3** | 数据模型 | Firestore 结构、TypeScript 类型定义 | S2 | ⏳ 待开始 |
| **S4** | 解析引擎 | 微信/支付宝 CSV 解析，错误收集 | S3 | ⏳ 待开始 |
| **S5** | 手动记账 | 表单录入、编辑、删除 | S3 | ⏳ 待开始 |
| **S6** | 统计图表 | 月度统计、分类饼图、趋势折线图 | S4, S5 | ⏳ 待开始 |
| **S7** | 分类管理 | 自定义分类、关键词规则编辑 | S4 | ⏳ 待开始 |
| **S8** | 数据导出 | 导出 CSV/Excel、筛选导出 | S6 | ⏳ 待开始 |
| **S9** | 优化上线 | 性能优化、Firebase Hosting 部署 | S7, S8 | ⏳ 待开始 |

---

## S1 — 基础架构搭建（详细）

### 任务清单
```bash
# 1. 初始化 Vite + React + TypeScript
npm create vite@latest . -- --template react-ts
npm install

# 2. 安装 Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# 3. 安装核心运行时依赖
npm install firebase react-router-dom zustand

# 4. 安装开发工具依赖
npm install -D @types/node
```

- [ ] 配置 `tailwind.config.js`（扫描 `src/**/*.{ts,tsx}`）
- [ ] 修改 `src/index.css`（引入 Tailwind 三行指令）
- [ ] 配置 `vite.config.ts`（添加路径别名 `@/` → `./src/`）
- [ ] 配置 `tsconfig.json`（添加 `paths` 配置匹配别名）
- [ ] 建立六层目录结构（按 `CONVENTIONS.md`）
- [ ] 创建 `.env.local`（写入 Firebase 配置，此文件已在 .gitignore 中）
- [ ] 创建 `src/4_services/firebase/firebaseApp.ts`（Firebase SDK 初始化）
- [ ] 清理 Vite 模板默认文件（删除 `App.css`、`assets/react.svg` 等）
- [ ] 验证：`npm run dev` 成功启动

### S1 阻塞项
> ⚠️ 开发者需提供 Firebase `firebaseConfig` 对象

---

## S2 — 用户认证（详细）

### 任务清单
- [ ] Firebase Console 启用 Authentication（Email/Password + Google 登录）
- [ ] 创建 `src/4_services/firebase/authService.ts`（封装 signIn/signUp/signOut）
- [ ] 创建 `src/3_hooks/useAuth.ts`（监听 onAuthStateChanged）
- [ ] 创建 `src/5_store/authStore.ts`（Zustand，持久化用户状态）
- [ ] 创建 `src/1_pages/LoginPage.tsx`（登录/注册表单）
- [ ] 创建 `src/2_components/common/ProtectedRoute.tsx`（路由守卫组件）
- [ ] 配置 `App.tsx` 路由（BrowserRouter + 路由守卫）
- [ ] 验证：未登录访问首页 → 自动跳转登录页

---

## S3 — 数据模型设计（详细）

### Firestore 结构设计
```
users/{userId}/transactions/{transactionId}
  - id: string
  - date: string (YYYY-MM-DD)
  - amount: number
  - category: string
  - subCategory?: string
  - description: string
  - source: 'wechat' | 'alipay' | 'manual'
  - rawData: object
  - parseError?: string
  - isDuplicate?: boolean
  - createdAt: Timestamp

users/{userId}/categories/{categoryId}
  - name: string
  - parentCategory: string
  - keywords: string[]
  - createdAt: Timestamp
```

### 任务清单
- [ ] 创建 `src/types/Transaction.types.ts`
- [ ] 创建 `src/types/Category.types.ts`
- [ ] 创建 `src/types/ParseResult.types.ts`
- [ ] 创建 `src/4_services/firebase/billService.ts`（Firestore CRUD）
- [ ] 在 Firebase Console 配置 Firestore 安全规则

---

## S4 — 账单解析引擎（详细）

> 参考 `SKILL_DATA_PARSING.md` 的完整 SOP

### 任务清单
- [ ] 创建 `src/4_services/parsers/parseUtils.ts`（金额解析、日期解析、分类映射）
- [ ] 创建 `src/4_services/parsers/wechatParser.ts`（微信账单解析器）
- [ ] 创建 `src/4_services/parsers/alipayParser.ts`（支付宝账单解析器）
- [ ] 创建 `src/3_hooks/useFileImport.ts`（驱动导入流程的 Hook）
- [ ] 创建 `src/2_components/Import/FileDropzone.tsx`（文件拖拽上传区）
- [ ] 创建 `src/2_components/Import/ImportProgress.tsx`（进度 + 错误列表）
- [ ] 创建 `src/1_pages/ImportPage.tsx`（导入页面）
- [ ] 单元测试：用真实微信/支付宝账单 CSV 文件验证解析正确性

---

## S5-S9 说明

S5-S9 的详细任务将在对应阶段开始前展开，**避免过早规划消耗精力**。
届时更新本文件的对应章节。
