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
| **S7** | 权限与多账套 | 账套切换UI、RBAC、溯及既往修正 | 🔄 进行中 |
| **S8** | 协作与权限隔离 | 账套成员邀请、角色权限管控（只读/编辑/管理） | ⏳ 待开始 |
| **S9** | 数据导出 | 按账套导出 CSV/Excel | ⏳ 待开始 |
| **S10** | 优化上线 | 性能优化、Firebase Hosting | ⏳ 待开始 |
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

## ⏳ S8 — 协作与权限隔离

> **前置条件**：依赖 S5 Firebase Auth（uid 鉴权）+ Ledger.members[] 模型（S7 已完成底层注入）
>
> **架构基础**：`Ledger.members[]` 成员集合制已在 S7 RBAC Prep 完成，
> 此阶段实现完整的协作入口 UI 和 Firestore 安全规则落地。

### 8.1 账套成员邀请流程
- [ ] `InviteMemberModal.tsx`：邀请成员弹窗
  - 输入对方 Email / UID → 选择角色（viewer / editor / admin）→ 发送邀请
  - 邀请状态：pending → accepted / rejected（Firestore `invitations` 子集合）
- [ ] `src/services/firebase/memberService.ts`：成员管理服务
  - `inviteMember(ledgerId, email, role)` — 写入邀请记录
  - `acceptInvitation(invitationId)` — 接受邀请，追加到 `ledger.members[]` + 子集合
  - `removeMember(ledgerId, userId)` — 移除成员（仅 admin/owner 可操作）
  - `transferOwnership(ledgerId, newOwnerUid)` — 账套转让（owner 专属）
- [ ] 邀请通知：Firestore `notifications` 集合 + 前端 Badge 提示

### 8.2 角色权限管控（RBAC 前端执行层）
- [ ] `usePermission(ledgerId)` Hook：封装当前用户在指定账套的角色查询
  ```typescript
  // 用法示例
  const { canWrite, canManageMembers, isOwner } = usePermission(activeLedgerId)
  ```
- [ ] 前端权限守卫：基于 `canWrite` / `canManageMembers` 控制按钮显示/禁用
  - 只读用户（viewer）：导入按钮隐藏、纠偏按钮禁用
  - 编辑用户（editor）：可录入账单，无法进入成员管理
  - 管理员（admin）：可邀请/移除成员，不可删除账套
  - 所有者（owner）：全部功能解锁

### 8.3 Firestore 安全规则（与 S5 Firebase 接入同步落地）
- [ ] `firestore.rules`：基于 `members` 数组的复合鉴权规则
  ```javascript
  // 账套读取：members 数组中存在当前 uid
  function isMember(ledgerId) {
    return request.auth.uid in
      get(/databases/$(db)/documents/ledgers/$(ledgerId)).data.members
      .map(m, m.userId);
  }
  // 账单写入：role 需为 editor/admin/owner
  function canWrite(ledgerId) {
    let members = get(/databases/$(db)/documents/ledgers/$(ledgerId)).data.members;
    let myMember = members.filter(m, m.userId == request.auth.uid)[0];
    return myMember.role in ['editor', 'admin', 'owner'];
  }
  ```
- [ ] 成员管理操作权限（admin+owner）
- [ ] 账套删除权限（owner 专属）
- [ ] 跨账套读取硬性封锁（`ledgerId` 字段必须匹配）

### 8.4 LedgerSettingsPage（账套设置页）
- [ ] 基本信息编辑（名称 / 货币 / 时区 / 描述）
- [ ] 成员列表（展示头像/昵称/角色）
- [ ] 邀请入口 → `InviteMemberModal`
- [ ] 危险区：归档账套 / 转让所有权 / 删除账套（需二次确认）

---

## ⏳ S9 — 数据导出

- [ ] 按当前活跃账套 + 日期范围筛选导出
- [ ] 支持 CSV / Excel 格式

---

## ⏳ S10 — 优化上线

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

### SX.5 跨账套数据同步与血缘追溯（Data Pedigree）

> **战略背景**：同一笔交易可能需要同时记录在多个账套中
> （如一笔差旅费既属于"个人账本"，也属于"Ming Pao Canada 报销账套"），
> 系统需支持"克隆并追溯"，而非简单复制后失去关联。

#### 底层预留（已完成 ✅）
- `Transaction.clonedFromId?: string`  — 指向原始记录的 Firestore 文档 ID
- `Transaction.sourceLedgerId?: string` — 指向来源账套 ID
- 冗余存储 sourceLedgerId 的原因：Firestore 安全规则限制跨账套读取，
  本账套权限内也能展示来源标签，无需跨权限查询

#### SX 阶段实现（待开发）
- [ ] **一键克隆操作**：账单详情页"克隆到其他账套"按钮
  - 选择目标账套 → 生成新记录（自动注入 `clonedFromId` + `sourceLedgerId`）
  - 支持附件关联（Firebase Storage 文件 URL 共用，不重复上传）
- [ ] **血缘标记 UI**：账单列表中克隆记录右上角显示「↗ 来源: 个人账本」徽章
- [ ] **血缘查询 API**：`billService.findClones(transactionId)` — 查找所有派生副本
- [ ] **跨账套对账视图**：按 `clonedFromId` 聚合，对比原始记录与各克隆版本的差异
- [ ] **断链检测**：若原始记录被删除，派生记录的 `clonedFromId` 标记为"孤儿"状态
