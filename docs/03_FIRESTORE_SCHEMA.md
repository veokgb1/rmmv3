# RMMV3 Firestore 数据库设计文档
> 版本：S3 | 更新日期：2026-03-31
> 核心设计原则：以 `ledgerId` 实现多账套逻辑隔离，以 `userId` 记录操作者

---

## 一、设计哲学

### 1.1 多账套隔离策略

RMMV3 采用**扁平集合 + 复合索引**的隔离方案，而非嵌套子集合。

```
✅ 选用方案（扁平）：        ❌ 放弃方案（嵌套）：
transactions/               ledgers/{ledgerId}/
  {txId}: { ledgerId, ... }   transactions/{txId}
```

**选用扁平方案的原因：**
- Firestore 跨集合聚合查询困难，嵌套会让统计类查询变得极复杂
- 扁平结构配合复合索引，查询性能更优
- 账套切换只需改变查询的 `ledgerId` 参数，Service 层接口不变

### 1.2 隔离键优先级

每条 `transactions` 记录的查询链：

```
WHERE ledgerId == "mingpao-ca"     ← 第一过滤条件（账套隔离）
  AND userId  == "uid-xxx"         ← 第二过滤条件（用户隔离，可选）
  AND date    >= "2026-03-01"      ← 业务条件
ORDER BY date DESC
```

---

## 二、集合总览

```
Firestore Database
│
├── users/                    用户档案（1用户 = 1文档）
│   └── {userId}/
│       └── [document]
│
├── ledgers/                  账套（1账套 = 1文档）
│   └── {ledgerId}/
│       ├── [document]
│       └── members/          账套成员与权限（子集合）
│           └── {userId}/
│               └── [document]
│
├── transactions/             账单记录（核心数据，扁平存储）
│   └── {transactionId}/
│       └── [document]        ← 含 ledgerId 隔离键
│
└── categories/               自定义分类（账套内）
    └── {categoryId}/
        └── [document]        ← 含 ledgerId 隔离键
```

---

## 三、集合详细设计

### 3.1 `users` 集合

**路径**：`users/{userId}`
**文档 ID**：与 Firebase Auth UID 完全一致

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `uid` | string | ✅ | Firebase Auth UID |
| `displayName` | string | ✅ | 显示名称 |
| `email` | string | ✅ | 邮箱（冗余，方便查询） |
| `avatarUrl` | string | ❌ | 头像 URL |
| `activeLedgerId` | string | ✅ | 当前激活的账套 ID |
| `ledgerIds` | string[] | ✅ | 有权访问的账套列表 |
| `preferredCurrency` | string | ✅ | 首选货币，ISO 4217 |
| `preferredTimezone` | string | ✅ | 首选时区，IANA |
| `preferredLocale` | string | ✅ | 首选语言，如 zh-CN |
| `createdAt` | number | ✅ | 注册时间戳（毫秒） |
| `lastSeenAt` | number | ✅ | 最后活跃时间戳（毫秒） |

**示例文档**：
```json
{
  "uid": "KLmN8pQ...",
  "displayName": "开发者",
  "email": "dev@example.com",
  "activeLedgerId": "personal",
  "ledgerIds": ["personal", "mingpao-ca"],
  "preferredCurrency": "CNY",
  "preferredTimezone": "Asia/Shanghai",
  "preferredLocale": "zh-CN",
  "createdAt": 1743350400000,
  "lastSeenAt": 1743350400000
}
```

---

### 3.2 `ledgers` 集合

**路径**：`ledgers/{ledgerId}`
**文档 ID**：人类可读的语义 ID（如 `personal` / `mingpao-ca`）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 与文档 ID 一致 |
| `name` | string | ✅ | 账套显示名称 |
| `type` | string | ✅ | `personal` / `family` / `enterprise` |
| `ownerUid` | string | ✅ | 所有者的 Firebase Auth UID |
| `currency` | string | ✅ | 主货币，ISO 4217 |
| `timezone` | string | ✅ | 时区，IANA |
| `description` | string | ❌ | 账套描述 |
| `logoUrl` | string | ❌ | 账套图标 URL |
| `createdAt` | number | ✅ | 创建时间戳（毫秒） |
| `updatedAt` | number | ✅ | 最后更新时间戳（毫秒） |
| `isArchived` | boolean | ✅ | 是否归档（默认 false） |

**已规划账套文档**：

```
ledgers/personal        → 个人日常账本（默认）
ledgers/ledger-elderly  → 特定老年人账本
ledgers/mingpao-ca      → Ming Pao Canada（企业账套）
ledgers/mingpao-to      → Ming Pao Toronto（企业账套）
```

#### 3.2.1 `ledgers/{ledgerId}/members` 子集合

**路径**：`ledgers/{ledgerId}/members/{userId}`
**文档 ID**：成员的 Firebase Auth UID

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | ✅ | 成员 UID |
| `role` | string | ✅ | `viewer` / `editor` / `admin` / `owner` |
| `joinedAt` | number | ✅ | 加入时间戳（毫秒） |
| `nickname` | string | ❌ | 该成员在此账套的显示名 |

---

### 3.3 `transactions` 集合（核心）

**路径**：`transactions/{transactionId}`
**文档 ID**：Firestore 自动生成（`doc()` 不传参）

| 字段 | 类型 | 必填 | 索引 | 说明 |
|------|------|------|------|------|
| `id` | string | ✅ | — | 与文档 ID 一致 |
| **`ledgerId`** | string | ✅ | ✅ **复合** | **账套隔离键（第一查询条件）** |
| `userId` | string | ✅ | ✅ 复合 | 录入者 UID |
| `date` | string | ✅ | ✅ 复合 | YYYY-MM-DD |
| `amount` | number | ✅ | — | 正=收入，负=支出 |
| `category` | string | ✅ | ✅ 复合 | 一级分类 |
| `subCategory` | string | ❌ | — | 二级分类 ID |
| `description` | string | ✅ | — | 交易描述 |
| `source` | string | ✅ | — | `wechat`/`alipay`/`manual`/`bank` |
| `rawData` | map | ✅ | — | 原始行数据（永不丢弃） |
| `parseError` | string | ❌ | — | 解析错误描述 |
| `isDuplicate` | boolean | ❌ | — | 疑似重复标记 |
| `isVerified` | boolean | ❌ | — | 人工核实标记 |
| `createdAt` | number | ✅ | ✅ 复合 | 写入时间戳（毫秒） |
| `updatedAt` | number | ✅ | — | 最后修改时间戳（毫秒） |

**示例文档**：
```json
{
  "id": "Tx9kLmN8...",
  "ledgerId": "mingpao-ca",
  "userId": "KLmN8pQ...",
  "date": "2026-03-15",
  "amount": -1280.00,
  "category": "居住",
  "description": "办公室3月房租",
  "source": "manual",
  "rawData": {},
  "isVerified": true,
  "createdAt": 1743350400000,
  "updatedAt": 1743350400000
}
```

---

### 3.4 `categories` 集合

**路径**：`categories/{categoryId}`
**文档 ID**：Firestore 自动生成

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 与文档 ID 一致 |
| **`ledgerId`** | string | ✅ | **账套隔离键** |
| `parentCategory` | string | ✅ | 归属的一级系统分类 |
| `name` | string | ✅ | 自定义分类名称 |
| `keywords` | string[] | ✅ | 自动匹配关键词 |
| `color` | string | ❌ | 自定义颜色（十六进制） |
| `icon` | string | ❌ | 自定义 Emoji 图标 |
| `sortOrder` | number | ✅ | 排序权重（越小越靠前） |
| `isActive` | boolean | ✅ | 是否启用 |
| `createdAt` | number | ✅ | 创建时间戳（毫秒） |

---

## 四、Firestore 复合索引规划

### 必建索引（查询性能关键）

| 集合 | 索引字段组合 | 用途 |
|------|------------|------|
| `transactions` | `ledgerId ASC` + `date DESC` | 账套内按日期查全部账单 |
| `transactions` | `ledgerId ASC` + `category ASC` + `date DESC` | 账套内按分类筛选 |
| `transactions` | `ledgerId ASC` + `userId ASC` + `date DESC` | 按录入者查账单 |
| `transactions` | `ledgerId ASC` + `createdAt DESC` | 最新导入账单排序 |
| `categories` | `ledgerId ASC` + `parentCategory ASC` | 按一级分类查子分类 |

---

## 五、Firestore 安全规则（设计草案）

> 正式规则在 S7 阶段实现，此处为设计意图说明。

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 辅助函数：判断请求者是否为指定账套的成员
    function isMemberOf(ledgerId) {
      return exists(/databases/$(database)/documents/ledgers/$(ledgerId)/members/$(request.auth.uid));
    }

    // 辅助函数：获取请求者在账套中的角色
    function getRoleIn(ledgerId) {
      return get(/databases/$(database)/documents/ledgers/$(ledgerId)/members/$(request.auth.uid)).data.role;
    }

    // users 集合：只有本人可读写
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }

    // ledgers 集合：成员可读，admin/owner 可写
    match /ledgers/{ledgerId} {
      allow read: if isMemberOf(ledgerId);
      allow write: if getRoleIn(ledgerId) in ['admin', 'owner'];

      match /members/{memberId} {
        allow read: if isMemberOf(ledgerId);
        allow write: if getRoleIn(ledgerId) in ['admin', 'owner'];
      }
    }

    // transactions 集合：账套成员可读，editor以上可写
    match /transactions/{txId} {
      allow read: if isMemberOf(resource.data.ledgerId);
      allow create: if isMemberOf(request.resource.data.ledgerId)
                    && getRoleIn(request.resource.data.ledgerId) in ['editor', 'admin', 'owner'];
      allow update, delete: if getRoleIn(resource.data.ledgerId) in ['editor', 'admin', 'owner'];
    }

    // categories 集合：同 transactions
    match /categories/{catId} {
      allow read: if isMemberOf(resource.data.ledgerId);
      allow write: if getRoleIn(resource.data.ledgerId) in ['editor', 'admin', 'owner'];
    }
  }
}
```

---

## 六、多账套数据流示意

```
用户登录
    ↓
读取 users/{uid}.activeLedgerId  →  "mingpao-ca"
    ↓
所有查询注入 ledgerId = "mingpao-ca"
    ↓
transactions WHERE ledgerId = "mingpao-ca" AND date >= "2026-03-01"
    ↓
结果返回 → UI 展示（用户感知不到后台隔离机制）
    ↓
用户点击"切换账套"
    ↓
更新 users/{uid}.activeLedgerId = "personal"
    ↓
所有查询自动切换为 ledgerId = "personal"（接口层零改动）
```

---

## 七、S3 阶段产出清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `docs/03_FIRESTORE_SCHEMA.md` | ✅ 本文件 | 完整 Schema 设计 |
| `src/types/Transaction.types.ts` | ✅ | 加入 `ledgerId`、`updatedAt`、`isVerified` |
| `src/types/Ledger.types.ts` | ✅ | 账套 + 成员 + 角色类型 |
| `src/types/Category.types.ts` | ✅ | 系统分类 + 自定义分类类型 |
| `src/types/User.types.ts` | ✅ | 用户档案 + 初始化函数 |
| `src/services/firebase/billService.ts` | ⏳ | 需 Firebase Config（S2 认证后实现） |
| `src/services/firebase/ledgerService.ts` | ⏳ | 需 Firebase Config |
| `firestore.rules` | ⏳ | S7 阶段正式实现 |
