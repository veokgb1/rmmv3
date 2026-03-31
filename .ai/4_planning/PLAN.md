# PLAN.md — RMMV3 S0-S9 完整执行计划

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 已完成 |
| **S1** | 基础架构 | Vite 项目、六层目录、四页面骨架 | ✅ 已完成 |
| **S2** | 用户认证 | 登录/注册页面、路由守卫、Auth Hook | ⏳ 待开始（需 Firebase Config）|
| **S3** | 数据模型 | Firestore 结构、TypeScript 类型定义 | ⏳ 待开始 |
| **S4** | 解析引擎 | 微信/支付宝 CSV 解析，错误收集 | ⏳ 待开始 |
| **S5** | 手动记账 | 表单录入、编辑、删除 | ⏳ 待开始 |
| **S6** | 统计图表 | 月度统计、分类饼图、趋势折线图 | ⏳ 待开始 |
| **S7** | 分类管理 | 自定义分类、关键词规则编辑 | ⏳ 待开始 |
| **S8** | 数据导出 | 导出 CSV/Excel、筛选导出 | ⏳ 待开始 |
| **S9** | 优化上线 | 性能优化、Firebase Hosting 部署 | ⏳ 待开始 |

---

## S1 完成总结（已归档）

**完成内容**：
- Vite 6 + React 18 + TypeScript 5 + Tailwind CSS 3 工程搭建
- 六层目录结构建立（pages / components / hooks / services / store / utils）
- 四个页面骨架（Home / Query / Report / Settings）
- BottomNav 底部导航（NavLink 激活高亮）
- 核心类型文件（Transaction.types.ts / ParseResult.types.ts）
- 工具函数（dateUtils.ts / numberUtils.ts）
- TypeScript 零错误，Vite build 验证通过

**S1 阶段禁止事项执行情况**：
- ✅ 未接入任何 API
- ✅ 未引入 Firebase SDK
- ✅ 所有代码含中文注释

---

## S2 — 用户认证（当前待执行）

### 前置条件
> ⚠️ 需要开发者提供 Firebase `firebaseConfig` 对象

### 任务清单
- [ ] 安装 Firebase SDK：`npm install firebase`
- [ ] 创建 `.env.local`，写入 `VITE_FIREBASE_*` 环境变量
- [ ] `src/services/firebase/firebaseApp.ts` — Firebase App 初始化（单例）
- [ ] `src/services/firebase/authService.ts` — signIn / signUp / signOut / getCurrentUser
- [ ] `src/hooks/useAuth.ts` — 监听 onAuthStateChanged，同步到 Store
- [ ] `src/store/authStore.ts` — Zustand，持久化用户 uid/email
- [ ] `src/pages/LoginPage.tsx` — 邮箱登录 + Google 一键登录
- [ ] `src/components/common/ProtectedRoute.tsx` — 路由守卫
- [ ] 更新 `src/App.tsx`：加入登录页路由 + 路由守卫包裹
- [ ] 验证：未登录访问 /home → 自动跳转 /login

---

## S3 — 数据模型（S2 完成后）

### Firestore 路径规划
```
users/{userId}/
  transactions/{txId}   ← 所有账单记录
  categories/{catId}    ← 用户自定义分类
  settings/profile      ← 用户偏好设置
```

### 任务清单
- [ ] `src/services/firebase/billService.ts` — Firestore CRUD（增删改查）
- [ ] Firebase Console 配置 Firestore 安全规则（仅允许 userId 匹配的用户访问）
- [ ] `src/hooks/useBills.ts` — 账单数据管理 Hook
- [ ] `src/store/billStore.ts` — 账单缓存 + 筛选条件状态

---

## S4-S9
详细任务在对应阶段开始前展开，避免过早规划。
