// 纠偏引擎服务（S7 Mock 纯前端版）
// 负责根据用户选择的 CorrectionPolicy 执行不同范围的账单修改
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  🔒 核心安全红线：所有纠偏操作绝对不允许跨越账套边界          ║
// ║     scopeLedgerId 是每个函数的第一道防火墙                    ║
// ║     "明报的纠偏不能污染长者账套" — 设计铁律                   ║
// ╚══════════════════════════════════════════════════════════════╝
//
// 数据血缘兼容：
//   当 transaction 含有 clonedFromId + sourceLedgerId 时（跨账套克隆副本），
//   纠偏操作仅影响当前账套的副本，不回溯修改原始账套的源记录。
//   SX 阶段实现"血缘同步通知"功能（可选择是否通知原账套所有者）。

import type { Transaction, CorrectionPolicy, CorrectionIntent } from '@/types/Transaction.types'

// ════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════

/**
 * isSimilarDescription — 判断两条描述是否"足够相似"用于溯及既往匹配
 * 策略：取前 20 个非空白字符比对（覆盖大多数"同商户"场景）
 * S7 Firestore 版本可升级为 TF-IDF 或 embedding 相似度
 */
function isSimilarDescription(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, '').substring(0, 20)
  return normalize(a) === normalize(b)
}

/**
 * assertLedgerScope — 账套边界强校验
 * 任何操作传入的 transaction 必须属于指定账套，否则抛出错误
 *
 * @throws Error 如果发现跨账套数据，立即中止操作
 */
function assertLedgerScope(transactions: Transaction[], scopeLedgerId: string): void {
  const outlier = transactions.find(t => t.ledgerId !== scopeLedgerId)
  if (outlier) {
    throw new Error(
      `[correctionService] 🚨 安全违规：账单 ${outlier.id} 属于账套 "${outlier.ledgerId}"，` +
      `不在当前操作作用域 "${scopeLedgerId}" 内。纠偏操作已中止。`
    )
  }
}

/**
 * findMatchingTransactions — 在指定账套内查找"相似且原值匹配"的记录
 * 用于溯及既往纠偏：找出需要批量修改的所有目标
 *
 * 匹配条件（三者必须同时满足）：
 *   1. ledgerId === scopeLedgerId      — 🔒 账套边界隔离
 *   2. t[field] === oldValue           — 原始字段值必须一致
 *   3. isSimilarDescription(...)      — 描述足够相似（同商户判断）
 */
function findMatchingTransactions(
  allTransactions: Transaction[],
  scopeLedgerId:      string,
  field:              keyof Transaction,
  oldValue:           unknown,
  referenceDesc:      string,
): Transaction[] {
  return allTransactions.filter(t => {
    // 🔒 铁律第一条：绝对不跨账套
    if (t.ledgerId !== scopeLedgerId) return false
    // 原字段值必须一致
    if (t[field] !== oldValue) return false
    // 描述相似（关键词级别）
    return isSimilarDescription(t.description, referenceDesc)
  })
}

// ════════════════════════════════════════════════════════════
// 纠偏策略函数
// ════════════════════════════════════════════════════════════

/** 纠偏操作的统一返回结构 */
export interface CorrectionResult {
  /** 需要更新的账单 ID 列表 */
  updatedIds:    string[]
  /** 需要应用的字段变更 */
  patch:         Partial<Transaction>
  /** 匹配到的记录总数（溯及既往时 > 1） */
  matchedCount:  number
  /** 创建的规则对象（rule_forward 策略时有值） */
  rule?:         CorrectionRule
}

/** Mock 规则对象（S7 Firestore 版写入 rules 集合） */
export interface CorrectionRule {
  id:           string
  ledgerId:     string   // 🔒 规则锁定在账套作用域内
  field:        string
  matchKeyword: string   // 触发规则的描述关键词
  applyValue:   unknown  // 自动应用的目标值
  createdAt:    number
}

// ── (a) 仅本次 ─────────────────────────────────────────────────
/**
 * applySingleCorrection — 只修改当前这一条账单
 * 最安全的操作，影响面最小
 */
export function applySingleCorrection(
  intent: CorrectionIntent,
): CorrectionResult {
  const patch = { [intent.field]: intent.newValue } as Partial<Transaction>
  return { updatedIds: [intent.transactionId], patch, matchedCount: 1 }
}

// ── (b) 创建规则（前向生效）────────────────────────────────────
/**
 * createCorrectionRule — 创建前向生效的自动分类规则
 *
 * 规则语义：下次导入相同商户/描述时，自动应用此分类/标签/账户
 * Mock 阶段只打印规则对象；S7 接入后写入 Firestore rules 集合
 *
 * 数据血缘注意：规则的 ledgerId 锁定在 scopeLedgerId，
 * 克隆到其他账套的副本不会继承此规则（各账套规则独立）
 *
 * @param scopeLedgerId 账套隔离键（规则只在此账套内生效）
 */
export function createCorrectionRule(
  intent:         CorrectionIntent,
  scopeLedgerId:  string,
): CorrectionResult & { rule: CorrectionRule } {
  // 🔒 规则绑定在当前账套作用域，不允许跨账套规则泄漏
  const rule: CorrectionRule = {
    id:           `rule-${Date.now()}`,
    ledgerId:     scopeLedgerId,
    field:        String(intent.field),
    matchKeyword: intent.matchRule ?? String(intent.oldValue),
    applyValue:   intent.newValue,
    createdAt:    Date.now(),
  }

  // S7 Mock 阶段：仅打印，不持久化
  console.info(`[纠偏规则·${scopeLedgerId}] 创建规则（前向生效）:`, rule)

  const patch = { [intent.field]: intent.newValue } as Partial<Transaction>
  return { updatedIds: [intent.transactionId], patch, matchedCount: 1, rule }
}

// ── (c) 溯及既往 ───────────────────────────────────────────────
/**
 * applyRetroactiveCorrection — 批量修改账套内所有历史相似记录
 *
 * ⚠️ 高危操作，执行前 CorrectionPolicyModal 已要求用户二次确认
 *
 * 安全机制：
 *   1. assertLedgerScope 确保传入数据不含跨账套记录
 *   2. findMatchingTransactions 的 ledgerId 过滤作为双重保险
 *
 * 数据血缘兼容：
 *   若 transaction 有 clonedFromId，溯及既往只影响本账套的副本，
 *   不会通过 clonedFromId 回溯修改原始账套的记录（需要 SX 阶段的"血缘同步"功能）
 *
 * @param allTransactions 全量账单（含所有账套，由此函数自行过滤）
 * @param scopeLedgerId   🔒 操作作用域，只允许修改此账套内的记录
 */
export function applyRetroactiveCorrection(
  intent:           CorrectionIntent,
  allTransactions:  Transaction[],
  scopeLedgerId:    string,
): CorrectionResult {
  // 找到被修改的原始账单（需要其 description 作为相似度基准）
  const sourceRecord = allTransactions.find(t => t.id === intent.transactionId)
  if (!sourceRecord) {
    // 找不到原始记录，退化为单条修改
    return applySingleCorrection(intent)
  }

  // 查找所有在作用域内、原值匹配、描述相似的历史记录
  const matched = findMatchingTransactions(
    allTransactions,
    scopeLedgerId,
    intent.field as keyof Transaction,
    intent.oldValue,
    sourceRecord.description,
  )

  // 合并：原始记录 + 匹配到的历史记录（去重）
  const updatedIds = Array.from(
    new Set([intent.transactionId, ...matched.map(t => t.id)])
  )

  const patch = { [intent.field]: intent.newValue } as Partial<Transaction>

  console.info(
    `[溯及既往·${scopeLedgerId}] `,
    `字段 "${String(intent.field)}" `,
    `"${String(intent.oldValue)}" → "${String(intent.newValue)}"，`,
    `匹配 ${updatedIds.length} 条记录`
  )

  return { updatedIds, patch, matchedCount: updatedIds.length }
}

// ════════════════════════════════════════════════════════════
// 统一入口函数
// ════════════════════════════════════════════════════════════

/**
 * handleCorrection — 纠偏引擎统一入口
 *
 * 根据用户在 CorrectionPolicyModal 中的选择，路由到对应处理函数
 * 调用方（useBills Hook）拿到结果后负责调用 billStore 的 updateOne/batchUpdate
 *
 * @param policy          用户选择的策略（once / rule_forward / retroactive）
 * @param intent          修改意图（字段、旧值、新值）
 * @param allTransactions 全量账单（含所有账套）
 * @param scopeLedgerId   🔒 账套隔离键，必填
 */
export function handleCorrection(
  policy:           CorrectionPolicy,
  intent:           CorrectionIntent,
  allTransactions:  Transaction[],
  scopeLedgerId:    string,
): CorrectionResult {
  switch (policy) {
    case 'once':
      return applySingleCorrection(intent)

    case 'rule_forward':
      return createCorrectionRule(intent, scopeLedgerId)

    case 'retroactive':
      return applyRetroactiveCorrection(intent, allTransactions, scopeLedgerId)

    default:
      // 防御性兜底（理论上不应该到达这里）
      console.warn('[correctionService] 未知策略，退化为单条修改:', policy)
      return applySingleCorrection(intent)
  }
}
