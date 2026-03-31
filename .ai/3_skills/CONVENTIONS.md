# CONVENTIONS.md — 六层架构规范
> RMMV3 的代码组织标准。所有新文件必须放入正确的层级目录。

---

## 六层目录结构

```
src/
├── 1_pages/          # 第一层：页面层（路由入口，只做组合，不含业务逻辑）
│   ├── DashboardPage.tsx
│   ├── BillsPage.tsx
│   └── SettingsPage.tsx
│
├── 2_components/     # 第二层：UI 组件层（纯展示，通过 props 驱动）
│   ├── BillList/
│   │   ├── BillList.tsx
│   │   └── BillListItem.tsx
│   └── Charts/
│       └── MonthlyChart.tsx
│
├── 3_hooks/          # 第三层：业务逻辑层（React Hooks，处理状态与副作用）
│   ├── useBills.ts        # 账单数据读写逻辑
│   ├── useAuth.ts         # 用户认证逻辑
│   └── useFileImport.ts   # 文件导入逻辑
│
├── 4_services/       # 第四层：服务层（与外部系统交互：Firebase、API）
│   ├── firebase/
│   │   ├── billService.ts      # Firestore 账单 CRUD
│   │   └── storageService.ts   # Firebase Storage 操作
│   └── parsers/
│       ├── wechatParser.ts     # 微信账单解析器
│       └── alipayParser.ts     # 支付宝账单解析器
│
├── 5_store/          # 第五层：全局状态层（Zustand 或 Context）
│   ├── authStore.ts       # 用户认证状态
│   └── billStore.ts       # 账单缓存状态
│
└── 6_utils/          # 第六层：工具函数层（纯函数，无副作用）
    ├── dateUtils.ts       # 日期格式化工具
    ├── numberUtils.ts     # 金额格式化工具
    └── categoryUtils.ts   # 分类辅助函数
```

---

## 各层职责与规则

### 第一层 Pages（页面）
- ✅ 允许：组合组件、调用 Hooks、定义路由参数
- ❌ 禁止：直接调用 Firebase、包含业务计算逻辑

### 第二层 Components（组件）
- ✅ 允许：接收 props 渲染 UI、局部 UI 状态（如弹窗开关）
- ❌ 禁止：直接访问 Store、调用 Service

### 第三层 Hooks（业务逻辑）
- ✅ 允许：调用 Service、读写 Store、处理异步逻辑
- ❌ 禁止：包含 JSX、直接操作 DOM

### 第四层 Services（服务）
- ✅ 允许：调用 Firebase SDK、调用第三方 API、文件解析
- ❌ 禁止：包含 React 相关代码、直接操作 UI 状态

### 第五层 Store（全局状态）
- ✅ 允许：定义全局共享状态、同步/异步 Action
- ❌ 禁止：包含业务计算逻辑（计算应在 Service 或 Hook 中完成）

### 第六层 Utils（工具函数）
- ✅ 允许：纯函数、无副作用的数据转换
- ❌ 禁止：调用任何外部服务、修改全局状态

---

## 文件命名规范
| 类型 | 规范 | 示例 |
|------|------|------|
| React 组件 | PascalCase + .tsx | `BillList.tsx` |
| Hook | camelCase + use前缀 + .ts | `useBills.ts` |
| Service | camelCase + Service后缀 + .ts | `billService.ts` |
| 工具函数 | camelCase + Utils后缀 + .ts | `dateUtils.ts` |
| 类型定义 | PascalCase + .types.ts | `Bill.types.ts` |
| 常量文件 | SCREAMING_SNAKE + .constants.ts | `CATEGORIES.constants.ts` |
