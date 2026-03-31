// 账单核心数据类型定义
// 所有层（Service / Hook / Store / Component）共享此类型，不得各自重复定义

// ── 账单来源枚举 ──────────────────────────────────────────────────
/** 账单数据来源标识 */
export type TransactionSource = 'wechat' | 'alipay' | 'manual' | 'bank'

// ── 一级分类类型 ──────────────────────────────────────────────────
/** 一级分类（固定值，对应 RULES.md R4 章节） */
export type CategoryName =
  | '餐饮' | '交通' | '购物' | '娱乐' | '医疗'
  | '居住' | '教育' | '工资' | '副业收入' | '理财收益'
  | '转账' | '未分类'

// ── 核心账单记录类型 ──────────────────────────────────────────────
/**
 * Transaction — 统一的账单记录结构
 * 无论来自微信、支付宝、手动录入，最终都必须映射到此结构
 */
export interface Transaction {
  id: string                              // Firestore 文档 ID（自动生成）
  userId: string                          // 用户 ID（数据隔离键）
  date: string                            // 交易日期 YYYY-MM-DD
  amount: number                          // 金额（正数=收入，负数=支出）
  category: CategoryName                  // 一级分类
  subCategory?: string                    // 二级分类（用户自定义）
  description: string                     // 交易描述/备注
  source: TransactionSource               // 数据来源
  rawData: Record<string, unknown>        // 原始行数据（完整保留，永不丢弃）
  parseError?: string                     // 解析错误标记（有值代表该字段解析失败）
  isDuplicate?: boolean                   // 疑似重复标记（不自动删除，由用户确认）
  createdAt?: number                      // 写入时间戳（毫秒，Firebase Timestamp 转换后）
}

// ── 创建账单时的输入类型（不含自动生成字段） ────────────────────
/**
 * TransactionInput — 新建账单时的输入结构
 * 排除由系统自动生成的字段（id、userId、createdAt）
 */
export type TransactionInput = Omit<Transaction, 'id' | 'userId' | 'createdAt'>
