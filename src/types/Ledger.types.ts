// 账套（Ledger）核心类型定义 — S8 RBAC 升级版
// 关键架构变更：从"单主制（ownerUid）"升级为"成员集合制（members[]）"
// 这一变更为多人协作奠定底层基因，使账套天然支持夫妻共账、团队共享等场景
//
// 架构决策备忘：
//   旧模型（单主制）：Ledger.ownerUid = "uid-xxx"
//     ✗ 无法表达"甲是管理员、乙是只读"等差异化权限
//     ✗ 权限判断散落在业务逻辑中，难以统一审计
//
//   新模型（成员集合制）：Ledger.members = [{ userId, role, joinedAt }]
//     ✓ RBAC（基于角色的访问控制）内嵌于账套文档
//     ✓ Firestore Security Rules 直接基于 members 数组鉴权，无需额外查询
//     ✓ owner 角色通过 role='owner' 表达，语义更清晰
//     ✓ 未来支持账套转让（修改角色）、成员邀请、成员移除

// ── 账套角色枚举（权限层级从低到高）─────────────────────────
/**
 * LedgerRole — 成员在账套中的权限等级
 *
 * viewer  : 只读，可查看账单和报表，不可录入或修改
 * editor  : 编辑，可录入/修改账单，不可管理成员
 * admin   : 管理员，可邀请/移除成员（不包括 owner），不可删除账套
 * owner   : 所有者，拥有全部权限（含删除账套、转让所有权）
 *           每个账套有且仅有一个 owner
 *
 * Firestore Security Rules 鉴权逻辑：
 *   读取账单：role in ['viewer','editor','admin','owner']
 *   写入账单：role in ['editor','admin','owner']
 *   管理成员：role in ['admin','owner']
 *   删除账套：role == 'owner'
 */
export type LedgerRole = 'viewer' | 'editor' | 'admin' | 'owner'

// ── 账套类型枚举 ──────────────────────────────────────────────
/**
 * LedgerType — 账套的业务性质
 * 影响统计维度、默认货币提示和导出格式
 */
export type LedgerType =
  | 'personal'    // 个人账本（单人，默认类型）
  | 'family'      // 家庭共享账本（夫妻/家庭成员共同记账）
  | 'enterprise'  // 企业/组织账本（如明报加拿大，多角色协作）

// ── 账套成员记录 ──────────────────────────────────────────────
/**
 * LedgerMember — 账套内单个成员的身份与权限记录
 *
 * 存储策略：内嵌在 Ledger.members 数组中（同时冗余一份到子集合）
 *
 * 内嵌优势：
 *   - 读取账套时一次性获得完整成员列表，无需额外查询
 *   - Security Rules 可直接访问 resource.data.members 进行权限判断
 *
 * 子集合优势（ledgers/{id}/members/{uid}）：
 *   - 支持按 userId 精确查询（"我参与了哪些账套"）
 *   - 成员数量极多时避免文档超过 1MB 限制
 *
 * 两者并存，以 members 数组为主权威数据，子集合为查询辅助。
 */
export interface LedgerMember {
  userId:    string      // 成员的 Firebase Auth UID（唯一标识）
  role:      LedgerRole  // 该成员在此账套中的角色
  joinedAt:  number      // 加入时间戳（毫秒，邀请接受时写入）
  invitedBy?: string     // 邀请人的 Firebase Auth UID（可选，用于审计）
  nickname?:  string     // 该成员在此账套的自定义显示名（覆盖全局 displayName）
}

// ── 账套核心文档结构（成员集合制）────────────────────────────
/**
 * Ledger — 账套主体文档
 * Firestore 路径：ledgers/{ledgerId}
 *
 * 多人协作数据流：
 *   1. owner 创建账套 → members = [{ userId: ownerUid, role: 'owner', joinedAt }]
 *   2. owner/admin 邀请成员 → 追加到 members 数组 + 子集合
 *   3. Firestore Rules 读取 members 数组判断请求者权限
 *   4. 账单写入时注入 userId（录入者）和 ledgerId（账套隔离键）
 *
 * 多账套隔离策略（不变）：
 *   所有 Transaction 记录均携带 ledgerId 字段，
 *   查询时以 ledgerId 为第一过滤条件，实现逻辑隔离。
 *   Security Rules 基于 members 数组验证请求者是否有权访问该账套。
 */
export interface Ledger {
  id:          string         // Firestore 文档 ID（即 ledgerId，人类可读语义 ID）
  name:        string         // 账套显示名称（如"明报加拿大"）
  type:        LedgerType     // 账套类型（影响 UI 提示和统计维度）
  currency:    string         // 主货币（ISO 4217，如 CNY / CAD / USD）
  timezone:    string         // 时区（IANA，如 Asia/Shanghai / America/Toronto）

  /**
   * members — 账套成员列表（RBAC 核心字段）
   *
   * 设计约束：
   *   - 有且仅有一个 role='owner' 的成员
   *   - 创建账套时自动将创建者写入 members（role='owner'）
   *   - 成员数量建议不超过 50（Firestore 文档 1MB 限制）
   *   - 数量超过 50 时退化为纯子集合模式（不内嵌 members 数组）
   *
   * Security Rules 鉴权示例：
   *   function isMember(ledgerId) {
   *     return request.auth.uid in
   *       get(/databases/$(db)/documents/ledgers/$(ledgerId)).data.members
   *       .map(m, m.userId);
   *   }
   */
  members:     LedgerMember[] // ← 取代旧版 ownerUid 字段，支持多人协作

  description?: string        // 账套描述（可选）
  logoUrl?:     string        // 账套图标 URL（可选，S8 阶段支持上传）
  createdAt:    number        // 创建时间戳（毫秒）
  updatedAt:    number        // 最后更新时间戳（毫秒）
  isArchived:   boolean       // 是否已归档（归档后不显示在切换列表中）
}

// ── 派生工具类型 ──────────────────────────────────────────────

/**
 * getLedgerOwner — 从成员列表中提取 owner 的 userId
 * 等价于旧版的 ledger.ownerUid，保持业务逻辑兼容
 */
export function getLedgerOwner(ledger: Ledger): string | undefined {
  return ledger.members.find(m => m.role === 'owner')?.userId
}

/**
 * getMemberRole — 查询指定用户在账套中的角色
 * @returns 角色名，若不是成员则返回 undefined
 */
export function getMemberRole(
  ledger: Ledger,
  userId: string,
): LedgerRole | undefined {
  return ledger.members.find(m => m.userId === userId)?.role
}

/**
 * canWrite — 判断指定用户是否有账单录入/修改权限
 * editor 及以上角色可写
 */
export function canWrite(ledger: Ledger, userId: string): boolean {
  const role = getMemberRole(ledger, userId)
  return role === 'editor' || role === 'admin' || role === 'owner'
}

/**
 * canManageMembers — 判断指定用户是否有成员管理权限
 * admin 及以上角色可管理成员
 */
export function canManageMembers(ledger: Ledger, userId: string): boolean {
  const role = getMemberRole(ledger, userId)
  return role === 'admin' || role === 'owner'
}

// ── 已知账套常量 ──────────────────────────────────────────────
/**
 * KNOWN_LEDGER_IDS — 已规划的账套 ID
 * S7 阶段写入 Firestore 初始化脚本
 */
export const KNOWN_LEDGER_IDS = {
  PERSONAL:   'personal',       // 个人日常账本（默认）
  ELDERLY:    'ledger-elderly', // 特定老年人账本
  MINGPAO_CA: 'mingpao-ca',     // Ming Pao Canada
  MINGPAO_TO: 'mingpao-to',     // Ming Pao Toronto
} as const

export type KnownLedgerId = typeof KNOWN_LEDGER_IDS[keyof typeof KNOWN_LEDGER_IDS]
