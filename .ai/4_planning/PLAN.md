# PLAN.md — RMMV3 S0-S9 完整执行计划

---

## 总览甘特图

| 阶段 | 名称 | 核心产出 | 状态 |
|------|------|----------|------|
| **S0** | 环境初始化 | AI 治理矩阵、Git 仓库 | ✅ 封板 |
| **S1** | 基础架构 | Vite 工程、六层目录、四页面骨架 | ✅ 封板 |
| **S2** | UI 增强 | Mock数据、Clock、天气、首页精美化 | ✅ 封板 |
| **S3** | 数据模型 | Firestore Schema、类型定义（含ledgerId） | 🔨 进行中 |
| **S4** | 解析引擎 | 微信/支付宝 CSV 解析 | ⏳ 待开始 |
| **S5** | 手动记账 | 表单录入、编辑、删除 | ⏳ 待开始 |
| **S6** | 统计图表 | 月度统计、分类饼图、趋势图 | ⏳ 待开始 |
| **S7** | 权限与租户 | **多账套切换 UI、ledger 权限体系** | ⏳ 待开始 |
| **S8** | 数据导出 | 按账套导出 CSV/Excel | ⏳ 待开始 |
| **S9** | 优化上线 | 性能优化、Firebase Hosting 部署 | ⏳ 待开始 |
| **SX** | 收尾增强 | 全局换皮肤 / 深色模式 / 多色系 | ⏳ 最终收尾 |

---

## ✅ S0/S1/S2 已封板归档（略）

---

## 🔨 S3 — 数据模型设计（当前阶段）

> ⚠️ S3 铁律：先设计后编码。本阶段核心产出是文档和类型，不写 Firebase 连接代码。

### 3.1 设计文档
- [x] `docs/03_FIRESTORE_SCHEMA.md`：完整 Firestore 集合/字段设计

### 3.2 TypeScript 类型
- [x] `src/types/Transaction.types.ts`：加入 `ledgerId`
- [x] `src/types/Ledger.types.ts`：账套类型定义
- [x] `src/types/Category.types.ts`：分类类型
- [x] `src/types/User.types.ts`：用户档案类型

### 3.3 Service 层（需 Firebase Config，暂缓）
- [ ] `src/services/firebase/firebaseApp.ts`（需 firebaseConfig）
- [ ] `src/services/firebase/billService.ts`（Firestore CRUD）
- [ ] `src/services/firebase/ledgerService.ts`（账套 CRUD）
- [ ] Firestore 安全规则（`firestore.rules`）

---

## ⏳ S4 — 账单解析引擎

- [ ] `src/services/parsers/wechatParser.ts`
- [ ] `src/services/parsers/alipayParser.ts`
- [ ] `src/services/parsers/parseUtils.ts`
- [ ] `src/hooks/useFileImport.ts`
- [ ] 导入页面 UI（`ImportPage.tsx`）

---

## ⏳ S5 — 手动记账

- [ ] 记账表单组件（金额/分类/日期/备注）
- [ ] `src/hooks/useBills.ts`
- [ ] `src/store/billStore.ts`

---

## ⏳ S6 — 统计图表

- [ ] 安装 Recharts：`npm install recharts`
- [ ] 月度收支趋势折线图
- [ ] 支出分类占比饼图
- [ ] 接入 WeatherWidget 真实 API（和风天气 / OpenWeatherMap）

---

## ⏳ S7 — 权限与多账套（Multi-Ledger）

> 📌 **战略备忘**：系统走向"通用型 SaaS"模式，以 `ledgerId` 实现数据逻辑隔离。

### 已知账套
| ledgerId | 名称 | 说明 |
|----------|------|------|
| `personal` | 个人账本 | 默认账套，S3 起即预留字段 |
| `ledger-elderly` | 老年人账本 | 特定用户群 |
| `mingpao-ca` | Ming Pao Canada | 企业账套 |
| `mingpao-to` | Ming Pao Toronto | 企业账套 |

### S7 任务
- [ ] `src/types/Ledger.types.ts` 扩展（权限角色：owner/editor/viewer）
- [ ] `src/services/firebase/ledgerService.ts`（账套 CRUD + 成员管理）
- [ ] `src/store/ledgerStore.ts`（当前活跃账套状态）
- [ ] 账套切换 UI（下拉选择器，嵌入顶部导航）
- [ ] Firestore 安全规则：基于 `ledgerId` + 角色的读写权限

---

## ⏳ S8 — 数据导出

- [ ] 按当前活跃账套筛选导出
- [ ] 支持 CSV / Excel 格式

---

## ⏳ S9 — 优化上线

- [ ] 性能优化（懒加载、分页）
- [ ] Firebase Hosting 部署
- [ ] PWA 配置（可选）

---

## SX — 收尾增强

- [ ] 全局换皮肤（深色模式、多色系主题）
- [ ] 字体大小切换
- [ ] Lightbox 图片弹窗
