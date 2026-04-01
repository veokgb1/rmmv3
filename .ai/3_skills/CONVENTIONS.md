# CONVENTIONS.md — RMMV3 六层架构规范
> 所有新文件必须放入正确的层级。创建文件前先对照此表确认归属。

---

## 完整目录树

```
src/
│
├── 1_pages/              # ① 页面层（路由入口，只负责组合，不含业务逻辑）
│   ├── DashboardPage.tsx     # 首页/总览
│   ├── BillsPage.tsx         # 账单列表页
│   ├── ImportPage.tsx        # 导入账单页
│   ├── StatsPage.tsx         # 统计图表页
│   ├── SettingsPage.tsx      # 设置页
│   └── LoginPage.tsx         # 登录/注册页
│
├── 2_components/         # ② 组件层（纯展示，Props 驱动，无副作用）
│   ├── BillList/
│   │   ├── BillList.tsx          # 账单列表容器
│   │   ├── BillListItem.tsx      # 单条账单项
│   │   └── BillListFilter.tsx    # 筛选栏
│   ├── Charts/
│   │   ├── MonthlyBarChart.tsx   # 月度收支柱状图（S6）
│   │   └── CategoryPieChart.tsx  # 分类占比饼图（S6）
│   ├── import/
│   │   └── ImportModal.tsx       # 导入弹窗（粘贴→解析→预览，S4 已完成）
│   ├── layout/
│   │   └── BottomNav.tsx         # 底部导航栏
│   └── widgets/
│       ├── ClockWidget.tsx       # 实时时钟组件
│       └── WeatherWidget.tsx     # 天气组件（Mock 数据，S6 接真实 API）
│
├── 3_hooks/              # ③ 业务逻辑层（React Hooks，处理状态与副作用）
│   ├── useBills.ts           # 账单数据读写（CRUD）
│   ├── useAuth.ts            # 用户认证状态
│   ├── useFileImport.ts      # 文件导入流程
│   ├── useStats.ts           # 统计数据计算
│   └── useCategories.ts      # 分类数据管理
│
├── 4_services/           # ④ 服务层（与外部系统交互）
│   ├── firebase/
│   │   ├── firebaseApp.ts        # Firebase 初始化（只初始化一次）
│   │   ├── billService.ts        # Firestore 账单 CRUD
│   │   ├── authService.ts        # Firebase Auth 操作
│   │   └── storageService.ts     # Firebase Storage 操作
│   └── parsers/
│       ├── index.ts              # 主入口：detectSource + parseBillText
│       ├── wechatParser.ts       # 微信账单 CSV 解析器
│       ├── alipayParser.ts       # 支付宝账单 CSV 解析器
│       └── parseUtils.ts         # 解析公共工具（金额、日期、分类）
│
├── 5_store/              # ⑤ 全局状态层（Zustand）
│   ├── authStore.ts          # 用户认证状态（持久化）
│   ├── billStore.ts          # 账单缓存与筛选条件
│   └── uiStore.ts            # UI 状态（Loading、Modal 开关）
│
├── 6_utils/              # ⑥ 工具函数层（纯函数，零副作用）
│   ├── dateUtils.ts          # 日期格式化：YYYY-MM-DD、月份分组
│   ├── numberUtils.ts        # 金额格式化：¥1,234.56
│   └── categoryUtils.ts      # 分类关键词匹配
│
└── types/                # 类型定义（跨层共享，不归属任何层）
    ├── Transaction.types.ts  # Transaction 接口（含战略支柱字段）
    ├── ParseResult.types.ts  # ParsedTransaction + ParseResult 接口
    ├── Account.types.ts      # 资金账户类型 + guessAccountId()
    ├── Ledger.types.ts       # 账套 + 成员 + 角色（RBAC）
    ├── Category.types.ts     # SystemCategory + CustomCategory
    └── User.types.ts         # UserProfile + 偏好设置
```

---

## 各层职责边界

### ① Pages — 页面层
| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 组合组件，调用 Hooks | 直接调用 Firebase SDK |
| 定义路由参数 | 包含业务计算逻辑 |
| 读取 Store 中的数据 | 直接操作 DOM |

### ② Components — 组件层
| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 接收 Props 渲染 UI | 直接访问 Zustand Store |
| 局部 UI 状态（弹窗开关） | 调用任何 Service |
| 触发父组件传入的回调函数 | 包含数据获取逻辑 |

### ③ Hooks — 业务逻辑层
| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 调用 Service 获取数据 | 包含 JSX/UI 渲染 |
| 读写 Zustand Store | 直接操作 DOM |
| 处理 async/await 逻辑 | — |

### ④ Services — 服务层
| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 调用 Firebase SDK | 包含 React Hooks |
| 文件解析（CSV/XLSX） | 直接操作 UI 状态 |
| 数据格式转换 | 调用 Zustand Store |

### ⑤ Store — 状态层
| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 定义全局共享状态 | 包含复杂业务计算 |
| 同步/异步 Action | 直接调用 Firebase |

### ⑥ Utils — 工具层
| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 纯函数，数据转换 | 调用任何外部服务 |
| 格式化，字符串处理 | 修改任何全局状态 |

---

## 新文件创建决策树

```
要创建新文件？
    ↓
是 UI 展示组件？
  ├── 是，被路由直接引用 → 1_pages/
  └── 是，被其他组件使用 → 2_components/
    ↓
是否包含 useState/useEffect 且有业务含义？
  └── 是 → 3_hooks/
    ↓
是否与 Firebase 交互 或 解析文件？
  └── 是 → 4_services/
    ↓
是否是跨组件共享的数据状态？
  └── 是 → 5_store/
    ↓
是纯函数、工具转换？
  └── 是 → 6_utils/
```
