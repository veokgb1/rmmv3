# PLAN.md — S1 至 S9 执行步骤表
> RMMV3 全量开发计划。每完成一个阶段，在 SESSION.md 中更新状态。

---

## 总览

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| S0 | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 已完成 |
| S1 | 基础架构 | Vite 项目、目录结构、Firebase 接入 | ⏳ 待开始 |
| S2 | 用户认证 | 登录/注册、路由守卫 | ⏳ 待开始 |
| S3 | 数据模型 | Firestore 结构设计、类型定义 | ⏳ 待开始 |
| S4 | 账单解析引擎 | 微信/支付宝 CSV 解析、错误处理 | ⏳ 待开始 |
| S5 | 手动记账 | 表单录入、编辑、删除 | ⏳ 待开始 |
| S6 | 统计与图表 | 月度统计、分类饼图、趋势折线图 | ⏳ 待开始 |
| S7 | 分类管理 | 自定义分类、关键词规则 | ⏳ 待开始 |
| S8 | 数据导出 | 导出 CSV/Excel | ⏳ 待开始 |
| S9 | 优化上线 | 性能优化、Firebase Hosting 部署 | ⏳ 待开始 |

---

## S1 详细任务：基础架构搭建

### 任务清单
- [ ] 1.1 初始化 Vite + React + TypeScript 项目
  ```bash
  npm create vite@latest . -- --template react-ts
  npm install
  ```
- [ ] 1.2 安装并配置 Tailwind CSS
  ```bash
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p
  ```
- [ ] 1.3 安装核心依赖
  ```bash
  npm install firebase react-router-dom zustand
  npm install -D @types/node
  ```
- [ ] 1.4 建立六层目录结构（参考 CONVENTIONS.md）
- [ ] 1.5 配置路径别名（`@/` → `src/`）
- [ ] 1.6 创建 `.env.local` 并写入 Firebase 配置
- [ ] 1.7 初始化 Firebase App

### 依赖项
- 需要用户提供 Firebase 项目配置（`firebaseConfig` 对象）

---

## S2 详细任务：用户认证

### 任务清单
- [ ] 2.1 启用 Firebase Authentication（邮箱/密码 + Google 登录）
- [ ] 2.2 创建 `authService.ts`（登录、注册、登出）
- [ ] 2.3 创建 `useAuth.ts` Hook
- [ ] 2.4 创建 `authStore.ts`（持久化用户状态）
- [ ] 2.5 创建登录页面 `LoginPage.tsx`
- [ ] 2.6 实现路由守卫（未登录重定向到登录页）

---

## S3 详细任务：数据模型设计

### Firestore 数据结构
```
users/{userId}/
  ├── transactions/{transactionId}   # 账单记录
  ├── categories/{categoryId}        # 自定义分类
  └── settings/{settingId}           # 用户设置
```

### 核心类型定义（`src/types/`）
```typescript
interface Transaction {
  id: string;
  date: string;          // YYYY-MM-DD
  amount: number;        // 正=收入，负=支出
  category: string;      // 一级分类
  subCategory?: string;  // 二级分类
  description: string;   // 交易描述
  source: 'wechat' | 'alipay' | 'manual' | 'bank';
  rawData?: object;      // 原始数据备份
  parseError?: string;   // 解析错误标记
  createdAt: Timestamp;  // 创建时间
}
```

---

## S4 详细任务：账单解析引擎

### 任务清单
- [ ] 4.1 实现 `wechatParser.ts`（参考 SKILL_DATA_PARSING.md）
- [ ] 4.2 实现 `alipayParser.ts`
- [ ] 4.3 实现 `useFileImport.ts` Hook（UI 层驱动导入流程）
- [ ] 4.4 实现导入进度展示组件
- [ ] 4.5 实现错误记录展示（让用户知道哪些行解析失败）
- [ ] 4.6 实现重复检测逻辑

---

## 后续阶段
S5-S9 的详细任务将在对应阶段开始前展开，避免过早规划浪费精力。
