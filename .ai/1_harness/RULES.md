# RULES.md — 核心业务规则与判定逻辑
> 从 PRD 提炼的硬性规则。AI 执行任何账单相关操作时，本文件优先级高于推断。

---

## R1 — 支持的数据来源

| 来源标识 | 文件格式 | 识别特征（文件头部关键字） |
|----------|----------|--------------------------|
| `wechat` | CSV | `微信支付账单明细` |
| `alipay` | CSV | `支付宝交易记录明细查询` |
| `manual` | 表单 | 用户直接在 UI 输入 |
| `bank` | CSV/XLSX | 待扩展（S8 阶段） |

---

## R2 — 统一数据模型（Transaction）

> ⚠️ 此为 S4 战略升级版，与 `src/types/Transaction.types.ts` 保持同步。

无论来源，每条记录最终必须能映射到此结构，**不得丢失字段**：

```typescript
// 核心账单记录类型（S4 战略升级版）
interface Transaction {
  // ── 系统字段（Service 层自动注入）─────────────────────────
  id:        string   // Firestore 文档 ID
  createdAt: number   // 首次写入时间戳（毫秒）
  updatedAt: number   // 最后修改时间戳（毫秒）

  // ── 多账套隔离键（查询第一条件）──────────────────────────
  ledgerId:  string   // 账套 ID（如 'personal' / 'mingpao-ca'）
  userId:    string   // Firebase Auth UID

  // ── 业务核心字段 ───────────────────────────────────────────
  date:         string    // 交易日期 YYYY-MM-DD
  amount:       number    // 金额（正数=收入，负数=支出）
  category:     string    // 一级分类（见 R4）
  subCategory?: string    // 二级分类（用户自定义）
  description:  string    // 交易描述/备注

  // ── 战略支柱①：多维标签与资金账户 ───────────────────────
  tags:      string[]  // 多维标签数组（自由打标）
  accountId: string    // 资金账户 ID（关联 Account 集合）

  // ── 战略支柱②：录入方式与溯源 ──────────────────────────
  sourceType: 'csv' | 'ocr' | 'voice' | 'manual'  // 录入方式
  source:     'wechat' | 'alipay' | 'manual' | 'bank' | 'ocr'
  rawData:    Record<string, unknown>   // 原始行数据（永不覆盖）
  originalParsedData?: Record<string, unknown>  // 解析器首次输出存档
  isManuallyEdited?: boolean            // 是否经过人工修正

  // ── OCR 专用字段（sourceType='ocr' 时有效）───────────────
  ocrStatus?:     'pending' | 'reviewing' | 'confirmed' | 'rejected'
  ocrConfidence?: number          // 整体置信度 0-1
  ocrDoubtSpans?: OcrDoubtSpan[]  // 字段级存疑区域列表

  // ── 数据质量标记 ───────────────────────────────────────────
  parseError?:  string    // 解析错误描述
  isDuplicate?: boolean   // 疑似重复标记
  isVerified?:  boolean   // 人工核实完成标记
}
```

---

## R3 — 入账容错规则

| 异常情况 | 处理方式 | 禁止做法 |
|----------|----------|----------|
| 金额含有 `¥` `$` 等货币符号 | 自动去除符号，保留数字 | 抛出错误 |
| 日期格式不统一 | 尝试多种格式解析，失败则 `date: null` + 标记 `DATE_PARSE_FAILED` | 丢弃该行 |
| 分类无法匹配 | 归入「未分类」 | 阻断入账流程 |
| 整行解析失败 | 存入 `rawErrors[]`，单独收集 | 静默丢弃 |
| **重复检测** | 基于 `(date + amount + description)` 三元组标记 `isDuplicate: true` | 自动删除 |

**黄金原则：任何单行失败不得中断整批次导入流程。**

---

## R4 — 分类体系

### 一级分类（固定，不可删除）
```
餐饮 / 交通 / 购物 / 娱乐 / 医疗 / 居住 / 教育 /
工资 / 副业收入 / 理财收益 / 转账 / 未分类
```

### 分类判定规则
- 微信账单「转账」类型 → 分类 `转账`，**默认不计入支出统计**
- 微信账单「退款」类型 → amount 标记为正数（收入）
- 支付宝「收入」方向 → amount 为正数

---

## R5 — 统计计算规则

```
本月支出 = SUM(amount < 0 的记录) 取绝对值，排除「转账」分类
本月收入 = SUM(amount > 0 的记录)
净收支   = 本月收入 - 本月支出
```

---

## R6 — 数据安全规则

- 所有用户数据以 `userId` 为 Firestore 路径前缀，实现物理隔离
- 未登录状态禁止访问任何 `transactions` 接口
- 文件上传仅允许 `.csv` / `.xlsx`，大小上限 **10MB**
- `.env.local` 中的 Firebase 配置禁止提交到 Git

---

## R7 — 微信账单字段映射

| 原始列名 | 目标字段 | 转换规则 |
|----------|----------|----------|
| `交易时间` | `date` | 取前 10 位 `YYYY-MM-DD` |
| `金额(元)` | `amount` | 去除 `¥`，`收入`→正数，`支出`→负数 |
| `交易类型` | `category` | 关键词映射，见 SKILL_DATA_PARSING |
| `交易对方` | `description` | 与「商品」字段拼接 |
| `收/支` | — | 决定 amount 正负 |
| （全行） | `rawData` | 完整保留原始对象 |

---

## R8 — 支付宝账单字段映射

| 原始列名 | 目标字段 | 转换规则 |
|----------|----------|----------|
| `交易创建时间` | `date` | 取前 10 位 |
| `金额` | `amount` | 根据「收/支」字段决定正负 |
| `交易分类` | `category` | 关键词映射 |
| `商品说明` | `description` | 优先使用此字段 |
| `交易对方` | `description` | 商品说明为空时使用 |
| （全行） | `rawData` | 完整保留原始对象 |

---

## R9 — AI 模型版本治理（Model Versioning）

> 详细规范见 `docs/04_AI_GOVERNANCE.md`，本节为快速索引摘要。

### 基准线（Baseline）

```
最低可用版本底线：gemini-2.5-flash
调用入口（唯一）：src/services/aiService.ts → analyzeReceipt()
```

### 降级熔断（严格红线 🚨）

- **严禁**将模型回退至 `gemini-1.0-*` 或 `gemini-1.5-*` 系列
  - `1.x` 系列 API 端点逐步停用，调用将返回 404 并导致能力断崖
- **严禁**在 `aiService.ts` 之外硬编码任何模型名称字符串
- **严禁**将 `VITE_GEMINI_API_KEY` 提交至 Git（会被 Google 自动吊销）

### 演进路线（Future-proof ✅）

```
gemini-2.5-flash  →  gemini-3.x-flash  →  更高版本（随官方 API 迭代平滑升级）
```

升级时只需修改 `aiService.ts` 第 36 行的 `model` 字段，并在本文档更新版本记录。

### 合法分类约束（R9 ↔ R4 联动）

`aiService.ts` 的 Prompt 强制要求 Gemini 从 **R4 分类体系**中选值，
任何对 R4 一级分类的修改**必须同步更新** `aiService.ts` 中的 Prompt 合法值列表。
