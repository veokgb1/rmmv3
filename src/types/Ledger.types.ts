// 账套（Ledger）核心类型定义
// 多账套架构的底层数据模型，S3 阶段预留，S7 阶段实现完整切换 UI

// ── 账套角色枚举 ──────────────────────────────────────────────
/**
 * LedgerRole — 成员在账套中的角色（权限层级从低到高）
 * S7 阶段实现基于角色的读写控制（RBAC）
 */
export type LedgerRole =
  | 'viewer'   // 只读：可查看账单，不可新增/修改
  | 'editor'   // 编辑：可新增/修改账单，不可管理成员
  | 'admin'    // 管理员：可管理成员，不可删除账套
  | 'owner'    // 所有者：全部权限，包括删除账套

// ── 账套类型枚举 ──────────────────────────────────────────────
/**
 * LedgerType — 账套的业务类型
 * 用于区分个人账本和企业/团队账本，影响统计维度和导出格式
 */
export type LedgerType =
  | 'personal'    // 个人账本（默认）
  | 'family'      // 家庭共享账本
  | 'enterprise'  // 企业/组织账本（如明报加拿大）

// ── 账套成员记录 ──────────────────────────────────────────────
/**
 * LedgerMember — 账套成员的权限记录
 * 存储在账套文档的 members 子集合中
 */
export interface LedgerMember {
  userId:   string      // 成员的 Firebase Auth UID
  role:     LedgerRole  // 该成员在此账套中的角色
  joinedAt: number      // 加入时间（毫秒时间戳）
  nickname?: string     // 成员在此账套中的显示名（可选）
}

// ── 账套核心文档结构 ──────────────────────────────────────────
/**
 * Ledger — 账套主体
 * Firestore 路径：ledgers/{ledgerId}
 *
 * 数据隔离策略：
 *   所有 Transaction 记录均携带 ledgerId 字段，
 *   查询时以 ledgerId 为第一过滤条件，实现逻辑隔离。
 *   Firestore 安全规则验证请求者是否为该账套的成员。
 */
export interface Ledger {
  id:          string       // Firestore 文档 ID（即 ledgerId）
  name:        string       // 账套显示名称（如"明报加拿大"）
  type:        LedgerType   // 账套类型
  ownerUid:    string       // 所有者的 Firebase Auth UID
  currency:    string       // 主货币（ISO 4217，如 CNY / CAD / USD）
  timezone:    string       // 时区（IANA，如 Asia/Shanghai / America/Toronto）
  description?: string      // 账套描述（可选）
  logoUrl?:    string       // 账套图标 URL（可选，S7 阶段上传）
  createdAt:   number       // 创建时间戳（毫秒）
  updatedAt:   number       // 最后更新时间戳（毫秒）
  isArchived:  boolean      // 是否已归档（不显示在切换列表中）
}

// ── 已知账套常量（当前规划） ──────────────────────────────────
/**
 * KNOWN_LEDGER_IDS — 已规划的账套 ID 列表
 * S3 阶段仅作为注释文档，S7 阶段写入 Firestore 初始化脚本
 */
export const KNOWN_LEDGER_IDS = {
  PERSONAL:      'personal',       // 个人日常账本（默认）
  ELDERLY:       'ledger-elderly', // 特定老年人账本
  MINGPAO_CA:    'mingpao-ca',     // Ming Pao Canada
  MINGPAO_TO:    'mingpao-to',     // Ming Pao Toronto
} as const

// 提取 ledgerId 联合类型，供 Transaction 等类型复用
export type KnownLedgerId = typeof KNOWN_LEDGER_IDS[keyof typeof KNOWN_LEDGER_IDS]
