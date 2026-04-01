// 资金账户（Asset Account）类型定义
// 记录"钱从哪里来/付到哪里去"的资金性质维度
// S4 阶段仅做类型预留，S7 阶段实现账户管理 UI

// ── 账户类型枚举 ──────────────────────────────────────────────
/**
 * AccountType — 资金账户的类型分类
 * 决定该账户在资产负债表中的归属
 */
export type AccountType =
  | 'cash'           // 现金（实体钞票）
  | 'debit_card'     // 储蓄卡/借记卡
  | 'credit_card'    // 信用卡（负债性质）
  | 'e_wallet'       // 电子钱包（微信零钱、支付宝余额）
  | 'investment'     // 投资账户（余额宝、基金）
  | 'loan'           // 贷款账户（花呗、借呗、网贷）
  | 'other'          // 其他

// ── 资金账户文档结构 ──────────────────────────────────────────
/**
 * Account — 资金账户
 * Firestore 路径：ledgers/{ledgerId}/accounts/{accountId}
 *
 * 设计原则：账户隶属于账套，不同账套的账户互不干扰
 */
export interface Account {
  id:          string       // Firestore 文档 ID（即 accountId）
  ledgerId:    string       // 所属账套 ID（隔离键）
  name:        string       // 账户显示名（如"招行信用卡"、"微信零钱"）
  type:        AccountType  // 账户类型
  currency:    string       // 账户货币（ISO 4217，如 CNY / CAD）
  initialBalance: number    // 初始余额（建账时录入，单位：分，避免浮点误差）
  icon?:       string       // 自定义图标 Emoji
  color?:      string       // 自定义颜色（十六进制）
  isDefault:   boolean      // 是否为默认支付账户（新建账单时自动填充）
  isArchived:  boolean      // 是否归档（不再使用但保留历史数据）
  createdAt:   number       // 创建时间戳（毫秒）
}

// ── 系统预置账户 ID 常量 ──────────────────────────────────────
/**
 * PRESET_ACCOUNT_IDS — 解析 CSV 时可自动识别的预置账户
 * 微信/支付宝账单中通常含有"支付方式"字段，可据此自动匹配
 */
export const PRESET_ACCOUNT_IDS = {
  WECHAT_BALANCE:   'acc-wechat-balance',    // 微信零钱
  WECHAT_CARD:      'acc-wechat-card',       // 微信绑定银行卡（储蓄卡/信用卡）
  ALIPAY_BALANCE:   'acc-alipay-balance',    // 支付宝余额
  ALIPAY_HUABEI:    'acc-alipay-huabei',     // 花呗（信用消费）
  ALIPAY_CARD:      'acc-alipay-card',       // 支付宝绑定银行卡
  CASH:             'acc-cash',              // 现金
  UNKNOWN:          'acc-unknown',           // 未知/无法识别
} as const

export type PresetAccountId = typeof PRESET_ACCOUNT_IDS[keyof typeof PRESET_ACCOUNT_IDS]

/**
 * guessAccountId — 根据支付方式文字推断账户 ID
 * 用于 CSV 解析时自动填充 accountId
 * @param paymentMethod 原始支付方式字符串（来自账单的"支付方式"字段）
 */
/**
 * guessAccountId — 根据支付方式文字推断账户 ID
 *
 * 解析逻辑（优先级从高到低）：
 *  1. 零钱通 / 微信零钱 → 微信余额账户
 *  2. 花呗              → 支付宝花呗（信用消费）
 *  3. 余额宝 / 支付宝余额→ 支付宝余额账户
 *  4. 现金              → 现金账户
 *  5. 含"微信"的银行卡  → 微信绑卡
 *  6. 含"支付宝"的银行卡→ 支付宝绑卡
 *  7. 其他银行卡/信用卡 → 微信绑卡（微信来源）/ 支付宝绑卡（支付宝来源）
 *     注：此函数不感知来源平台，银行卡兜底归入微信绑卡；
 *         调用方（alipayParser）可在结果为 WECHAT_CARD 时覆盖为 ALIPAY_CARD
 *
 * @param paymentMethod 原始支付方式字符串
 * @param platform      来源平台（'wechat' | 'alipay'），决定银行卡兜底归属
 */
export function guessAccountId(
  paymentMethod: string | undefined | null,
  platform: 'wechat' | 'alipay' = 'wechat',
): string {
  if (!paymentMethod) return PRESET_ACCOUNT_IDS.UNKNOWN

  const m = paymentMethod.trim()

  // 零钱 / 微信余额
  if (m.includes('零钱通') || m.includes('零钱'))   return PRESET_ACCOUNT_IDS.WECHAT_BALANCE
  // 花呗
  if (m.includes('花呗'))                           return PRESET_ACCOUNT_IDS.ALIPAY_HUABEI
  // 支付宝余额（余额宝也算）
  if (m.includes('余额宝') || m.includes('支付宝余额') || m === '余额')
                                                    return PRESET_ACCOUNT_IDS.ALIPAY_BALANCE
  // 现金
  if (m.includes('现金'))                           return PRESET_ACCOUNT_IDS.CASH
  // 平台特指银行卡
  if (m.includes('微信') && /卡/.test(m))           return PRESET_ACCOUNT_IDS.WECHAT_CARD
  if (m.includes('支付宝') && /卡/.test(m))         return PRESET_ACCOUNT_IDS.ALIPAY_CARD
  // 通用银行卡/信用卡：按来源平台归属
  if (/[储蓄借记信用]卡|银行卡/.test(m)) {
    return platform === 'alipay'
      ? PRESET_ACCOUNT_IDS.ALIPAY_CARD
      : PRESET_ACCOUNT_IDS.WECHAT_CARD
  }

  return PRESET_ACCOUNT_IDS.UNKNOWN
}
