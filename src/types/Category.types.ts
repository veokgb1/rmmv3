// 账单分类类型定义
// 一级分类为系统内置固定值，二级分类由用户在各账套内自定义

// ── 系统内置一级分类 ──────────────────────────────────────────
/**
 * SystemCategory — 系统预置的一级分类（不可删除，不可改名）
 * 对应 RULES.md R4 章节
 */
export type SystemCategory =
  | '餐饮'
  | '交通'
  | '购物'
  | '娱乐'
  | '医疗'
  | '居住'
  | '教育'
  | '工资'
  | '副业收入'
  | '理财收益'
  | '转账'
  | '未分类'

// ── 用户自定义二级分类文档结构 ───────────────────────────────
/**
 * CustomCategory — 用户在账套内创建的自定义分类
 * Firestore 路径：ledgers/{ledgerId}/categories/{categoryId}
 *
 * 设计原则：二级分类挂载在账套下，不同账套的分类互不干扰
 */
export interface CustomCategory {
  id:             string          // Firestore 文档 ID
  ledgerId:       string          // 所属账套 ID（隔离键）
  parentCategory: SystemCategory  // 归属的一级分类
  name:           string          // 自定义分类名称（如"公司报销"）
  keywords:       string[]        // 自动匹配关键词（如["报销","公务"]）
  color?:         string          // 自定义颜色（十六进制，可选）
  icon?:          string          // 自定义 Emoji 图标（可选）
  sortOrder:      number          // 排序权重（越小越靠前）
  isActive:       boolean         // 是否启用（false=隐藏但不删除）
  createdAt:      number          // 创建时间戳（毫秒）
}
