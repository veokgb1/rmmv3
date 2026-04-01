# SESSION.md — 当前阶段状态追踪

---

## ✅ 当前阶段：S4 — 账单解析引擎（战略升级版，封板归档）

### S4 基础解析引擎（完成清单）
- [x] `src/types/ParseResult.types.ts`：S4 战略升级版（ParsedTransaction 含三大战略字段）
- [x] `src/services/parsers/parseUtils.ts`：公共工具（mapCategory / parseAmount / parseDate / parseCsvLine / buildRowMap）
- [x] `src/services/parsers/wechatParser.ts`：微信账单解析器（STEP 1-7）
- [x] `src/services/parsers/alipayParser.ts`：支付宝账单解析器（STEP 1-7）
- [x] `src/services/parsers/index.ts`：主入口（detectSource + parseBillText）
- [x] `src/components/import/ImportModal.tsx`：导入弹窗（粘贴→解析→预览三阶段）
- [x] `HomePage.tsx`：导入按钮接入 ImportModal

### S4 战略升级（三大支柱注入，完成清单）
- [x] `src/types/Account.types.ts`：资金账户类型 + `guessAccountId()` 自动推断
- [x] `src/types/Transaction.types.ts`：注入 tags / accountId / sourceType / originalParsedData / isManuallyEdited / ocrStatus / ocrConfidence / ocrDoubtSpans / CorrectionPolicy / CorrectionIntent
- [x] `src/types/ParseResult.types.ts`：ParsedTransaction 同步三大战略字段
- [x] `src/services/parsers/wechatParser.ts`：填充 tags / accountId / sourceType / originalParsedData / ocrConfidence / ocrDoubtSpans
- [x] `src/services/parsers/alipayParser.ts`：同上
- [x] `.ai/4_planning/PLAN.md`：S6 OCR UI 规格 / S7 CorrectionPolicyModal / SX.2 模型中控台适配层 全部更新
- [x] TypeScript 零错误，Vite build 成功（1.14s）

### S4 未完成（等待 Firebase Config）
- [ ] `src/services/firebase/billService.ts`：解析后写入 Firestore
- [ ] 导入弹窗"确认导入"按钮真正入库（当前 disabled）

---

## 🔔 战略备忘（永久保留）

### 备忘 ①：多账套隔离（Multi-Ledger）
系统需支持多账套逻辑隔离，底层已预留 `ledgerId` 字段。
账套：personal / ledger-elderly / mingpao-ca / mingpao-to
切换 UI 在 S7 实现，当前只预留字段。

### 备忘 ②：换皮肤冻结至 SX
全局换皮肤 / 深色模式 / 多主题 → SX 收尾阶段统一实现。

---

## ▶ 当前进行：S7 核心 UI 骨架（Mock 驱动，第一波交付）

### S7 第一波完成清单
- [x] `src/mock/ledgers.mock.ts`：三个预设账套 Mock 数据（personal / mingpao-ca / ledger-elderly）
- [x] `src/components/ledger/LedgerSwitcher.tsx`：账套切换器（下拉菜单 + Toast + 点外关闭）
- [x] `src/components/ledger/CorrectionPolicyModal.tsx`：纠偏策略弹窗（三选一：仅限本次/创建规则/溯及既往）
- [x] `src/pages/HomePage.tsx`：集成 LedgerSwitcher（顶部导航）+ CorrectionPolicyModal（演示入口条 + 账单行 hover 触发）
- [x] TypeScript 零错误，Vite build 1.09s，51 模块通过

### S7 第二波完成清单（逻辑层）
- [x] `npm install zustand`：引入全局状态管理
- [x] `src/mock/transactions.mock.ts`：补齐全部 Transaction 必填字段（ledgerId/tags/accountId/sourceType/createdAt/updatedAt），三账套各分配真实数据
- [x] `src/store/ledgerStore.ts`：账套状态机（persist 持久化 activeLedgerId 至 localStorage）
- [x] `src/store/billStore.ts`：账单状态层（全量存储 + updateOne/batchUpdate/appendTransactions）
- [x] `src/services/correctionService.ts`：纠偏引擎（三策略路由 + 账套安全红线 assertLedgerScope + 数据血缘兼容注释）
- [x] `src/hooks/useLedger.ts`：账套业务 Hook（封装 ledgerStore）
- [x] `src/hooks/useBills.ts`：账单业务 Hook（自动按 activeLedgerId 过滤 + 统计计算 + correct 入口）
- [x] `src/components/ledger/LedgerSwitcher.tsx`：改为直接读写 ledgerStore，移除 Props 依赖
- [x] `src/pages/HomePage.tsx`：全面接入 useBills/useLedger，账套切换 → 数据物理联动
- [x] TypeScript 零错误，Vite build 1.16s，60 模块

### S7 综合封板补丁（V3-指令-03-综合，2026-04-01）
- [x] `src/types/Transaction.types.ts`：注入预支出基因（§3.10）
  - `status: 'expected' | 'cleared' | 'void'`（必填，默认 cleared）
  - `offsetByTxId?: string`（平替/报销轧账关联字段）
- [x] `src/mock/transactions.mock.ts`：所有 20 条记录补齐 `status: 'cleared'`
- [x] `src/pages/HomePage.tsx`：账单视图 Tab 栏（已结清 + 预支出🚧 S9 占位，disabled）
- [x] `.ai/4_planning/PLAN.md`：SX.5 垫资报销与公私隔离审批流规划注入
- [x] TypeScript 零错误（tsc --noEmit）

### S7 待完成（后续波次）
- [ ] `src/services/firebase/correctionService.ts`：S5 接入后写入 Firestore（替换 Mock 打印）
- [ ] Firestore Security Rules：多账套 RBAC 权限规则
- [ ] `LedgerSettingsPage.tsx`：账套管理页面（目前"管理账套"按钮已预留入口）

### ⚠️ S7 RBAC 架构补丁（2026-04-01 注入）
> **架构转变备忘**：已完成从「单用户私有账本」→「多用户共享账套」的底层模型升级。
> 核心变更：`Ledger.ownerUid: string` → `Ledger.members: LedgerMember[]`
>
> **S5 接入 Firebase 时强制约束**：
> - 数据库读写必须兼容成员鉴权逻辑（Security Rules 基于 `members` 数组，非 `ownerUid`）
> - `billService.ts` 写入账单前须调用 `canWrite(ledger, uid)` 验证权限
> - `ledgerService.fetchUserLedgers()` 须通过子集合 `collectionGroup('members').where('userId','==',uid)` 反查用户所属账套
> - 任何跨账套操作须通过 `assertLedgerScope()` 红线守卫

已同步文档：
- [x] `src/types/Ledger.types.ts`：成员集合制类型 + 四个 RBAC 工具函数
- [x] `src/mock/ledgers.mock.ts`：三账套 Mock 数据（含多角色演示）
- [x] `docs/03_FIRESTORE_SCHEMA.md`：Schema 升级至 S8-RBAC-Prep 版本
- [x] `.ai/4_planning/PLAN.md`：新增 S8 协作与权限隔离阶段

---

## ✅ 历史封板阶段
- S4（战略升级）：三大支柱字段注入 + 治理文档全局对齐（2026-04-01）
- S3：Firestore Schema + 类型体系（ledgerId 预留）
- S2：UI 增强（Clock / Weather / Mock 数据 / 首页精美化）
- S1：Vite 工程骨架
- S0：AI 治理矩阵

## 历史会话摘要
| 会话 | 日期 | 主要工作 |
|------|------|----------|
| #1-2 | 2026-03-31 | 治理矩阵初始化+重建 |
| #3 | 2026-03-31 | S1 前端骨架 |
| #4 | 2026-03-31 | GitHub 推送，S2 规划 |
| #5 | 2026-03-31 | S2 首波：Mock+首页+样式 |
| #6 | 2026-03-31 | S2 第二波：Clock + Weather |
| #7 | 2026-03-31 | S2 封板，S3 数据模型设计 |
| #8 | 2026-04-01 | S4 解析引擎 + ImportModal |
| #9  | 2026-04-01 | S4 战略升级：三大支柱字段注入（Account/Transaction/Parser 全线升级）|
| #10 | 2026-04-01 | 治理全局对齐：三处代码 Bug 修复 + RULES/MEMORY/CONVENTIONS 文档同步 |
| #11 | 2026-04-01 | S7 第一波：LedgerSwitcher + CorrectionPolicyModal + 首页集成 |
| #12 | 2026-04-01 | S7 第二波：Zustand 状态机 + 纠偏引擎 + 账套物理联动 + RBAC 架构补丁（members[]） |
