// 账单核心数据类型定义 — S3 版本（加入 ledgerId 多账套支持）
// 所有层（Service / Hook / Store / Component）共享此类型，不得各自重复定义

// ── 重导出分类类型（保持统一导入路径） ──────────────────────
export type { SystemCategory as CategoryName } from './Category.types'

// ── 账单来源枚举 ──────────────────────────────────────────────
/** 账单数据来源标识 */
export type TransactionSource = 'wechat' | 'alipay' | 'manual' | 'bank'

// ── 核心账单记录类型 ──────────────────────────────────────────
/**
 * Transaction — 统一的账单记录结构（S3 版本）
 *
 * 重要变更（S3 新增）：
 *   加入 `ledgerId` 作为顶层隔离键，所有查询必须以此为第一过滤条件。
 *   数据在 Firestore 中以扁平结构存储于 `transactions` 集合，
 *   通过 (ledgerId + userId) 复合索引实现隔离，无需嵌套子集合。
 */
export interface Transaction {
  // ── 系统字段（自动生成，写入时不需要提供） ────────────────
  id:        string   // Firestore 文档 ID（自动生成）
  createdAt: number   // 写入时间戳（毫秒，Firebase Timestamp 转换后）
  updatedAt: number   // 最后修改时间戳（毫秒）

  // ── 隔离键（查询第一条件，索引必建） ─────────────────────
  ledgerId:  string   // 账套 ID（如 'personal' / 'mingpao-ca'）
  userId:    string   // 操作用户的 UID（记录是谁录入的）

  // ── 业务核心字段 ───────────────────────────────────────────
  date:          string              // 交易日期 YYYY-MM-DD
  amount:        number              // 金额（正数=收入，负数=支出）
  category:      string              // 一级分类（对应 SystemCategory）
  subCategory?:  string              // 二级分类 ID（关联 CustomCategory.id）
  description:   string              // 交易描述/备注

  // ── 来源与原始数据 ─────────────────────────────────────────
  source:        TransactionSource           // 数据来源
  rawData:       Record<string, unknown>     // 原始行数据（永不丢弃）

  // ── 数据质量标记 ───────────────────────────────────────────
  parseError?:   string    // 解析错误描述（有值=该字段解析失败）
  isDuplicate?:  boolean   // 疑似重复标记（人工确认后清除）
  isVerified?:   boolean   // 人工核实标记（确认无误后设为 true）
}

// ── 创建账单时的输入类型 ──────────────────────────────────────
/**
 * TransactionInput — 调用方传入的创建数据
 * 排除由系统自动生成的字段（id / createdAt / updatedAt）
 * ledgerId 和 userId 由 Service 层从当前会话注入，调用方不需要传
 */
export type TransactionInput = Omit<
  Transaction,
  'id' | 'createdAt' | 'updatedAt' | 'ledgerId' | 'userId'
>

// ── 更新账单时的输入类型 ──────────────────────────────────────
/**
 * TransactionUpdate — 更新时允许修改的字段（部分更新）
 * 隔离键（ledgerId/userId）和系统字段不允许通过此类型修改
 */
export type TransactionUpdate = Partial<
  Pick<Transaction, 'date' | 'amount' | 'category' | 'subCategory'
                  | 'description' | 'isVerified' | 'isDuplicate'>
>
