// 账单版本记录类型定义 — S21 治理模块
// 对应 Firestore transactionVersions 集合文档结构
// 每次对账单执行治理操作（强制入账/作废/合并/字段修改）时写入一条版本记录

// ════════════════════════════════════════════════════════════════
// § 1  变更类型枚举
// ════════════════════════════════════════════════════════════════

/**
 * VersionChangeType — 治理操作类型
 * force_add    : 强制入账（清除重复标记，标为已核实）
 * archive      : 作废（status → void）
 * merge_keep   : 合并操作中被保留的一方
 * merge_remove : 合并操作中被作废的一方
 * field_update : 普通字段修改（纠偏/人工编辑）
 */
export type VersionChangeType =
  | 'force_add'
  | 'archive'
  | 'merge_keep'
  | 'merge_remove'
  | 'field_update'

// ════════════════════════════════════════════════════════════════
// § 2  版本记录结构
// ════════════════════════════════════════════════════════════════

export interface TransactionVersion {
  /** Firestore 文档 ID */
  id: string

  /** 被操作的账单 ID（关联 transactions 集合）*/
  transactionId: string

  /** 所属账套 ID（Firestore 查询隔离键）*/
  ledgerId: string

  /** 操作类型 */
  changeType: VersionChangeType

  /** 操作前的账单快照（完整字段）*/
  before: Record<string, unknown>

  /** 操作后的账单快照（完整字段）*/
  after: Record<string, unknown>

  /** 操作者 Firebase Auth UID */
  operatorUid: string

  /** 操作时间戳（Firestore serverTimestamp，读取后为 number ms）*/
  operatedAt: number

  /** 可选备注（如合并时填写原因）*/
  note?: string
}
