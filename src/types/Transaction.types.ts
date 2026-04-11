// 账单核心数据类型定义 — S4 战略升级版
// 注入三大战略支柱：多账套隔离、手写体溯源、模型中控预留
// 所有层共享此类型，不得各自重复定义

// ── 重导出分类类型（保持统一导入路径） ──────────────────────
export type { SystemCategory as CategoryName } from './Category.types'

// ════════════════════════════════════════════════════════════
// § 1  基础枚举类型
// ════════════════════════════════════════════════════════════

/**
 * TransactionSource — 账单数据来自哪个平台
 * （与 sourceType 区分：source=平台，sourceType=录入方式）
 */
export type TransactionSource = 'wechat' | 'alipay' | 'manual' | 'bank' | 'ocr'

/**
 * SourceType — 账单的录入方式（输入渠道）
 * csv       : 用户上传/粘贴 CSV 文件（目前主路径）
 * ocr       : 拍照/扫描手写单据，由 OCR 模型识别
 * voice     : 语音录入（未来功能）
 * manual    : 用户在 UI 表单中手动填写
 * V2_to_V3  : 通过前端 V2→V3 导入工具迁移的历史记录（S21）
 */
export type SourceType = 'csv' | 'ocr' | 'voice' | 'manual' | 'V2_to_V3'

/**
 * OcrStatus — OCR 识别状态（仅当 sourceType='ocr' 时有意义）
 * pending   : 等待识别
 * reviewing : AI 识别完成，等待人工核对
 * confirmed : 人工已确认
 * rejected  : 识别结果不可用，需重新录入
 */
export type OcrStatus = 'pending' | 'reviewing' | 'confirmed' | 'rejected'

// ════════════════════════════════════════════════════════════
// § 2  OCR 识别存疑区域（手写体专用）
// ════════════════════════════════════════════════════════════

/**
 * OcrDoubtSpan — 单个"识别存疑"区域
 * 对应 S6 UI 中：存疑文字高亮（黄色底纹）+ 点击弹出原图切片对比
 */
export interface OcrDoubtSpan {
  field:       string   // 存疑的字段名（如 'amount' / 'date' / 'description'）
  rawText:     string   // AI 原始识别文字（可能有误）
  confidence:  number   // 置信度 0-1（低于阈值时标记为存疑）
  imageSlice?: string   // 对应的原图切片 Base64（点击存疑区域时展示）
  suggestion?: string   // AI 给出的修正建议
}

// ════════════════════════════════════════════════════════════
// § 3  核心账单记录（Transaction）— 战略升级版
// ════════════════════════════════════════════════════════════

/**
 * Transaction — 统一的账单记录结构（S4 战略升级版）
 *
 * 相比 S3 新增字段：
 *   sourceType        — 录入方式（csv / ocr / voice / manual）
 *   tags              — 多维标签（支持自由打标，不受分类体系限制）
 *   accountId         — 资金账户 ID（"钱从哪里出/入"）
 *   originalParsedData— AI/解析器的原始输出留档（人工修正后仍可溯源）
 *   isManuallyEdited  — 是否经过人工修正
 *   ocrStatus         — OCR 识别工作流状态（仅 sourceType='ocr' 时有意义）
 *   ocrDoubtSpans     — OCR 存疑区域列表（驱动 S6 存疑高亮 UI）
 *   ocrConfidence     — 整体 OCR 置信度 0-1
 */
export interface Transaction {

  // ── § 3.1 系统字段（由 Service 层自动注入，调用方无需提供） ──
  id:        string   // Firestore 文档 ID
  createdAt: number   // 首次写入时间戳（毫秒）
  updatedAt: number   // 最后修改时间戳（毫秒）

  // ── § 3.2 多账套隔离键（查询第一条件，Firestore 必建索引） ──
  ledgerId:  string   // 账套 ID（如 'personal' / 'mingpao-ca'）
  userId:    string   // 录入者的 Firebase Auth UID

  // ── § 3.3 业务核心字段 ────────────────────────────────────
  date:         string    // 交易日期 YYYY-MM-DD
  amount:       number    // 金额（正数=收入，负数=支出）
  category:     string    // 一级分类（对应 SystemCategory）
  subCategory?: string    // 二级分类 ID（关联 CustomCategory.id，可选）
  description:  string    // 交易摘要/说明（主描述）
  remark?:      string    // 用户备注（说明二，可选；历史数据缺失时 undefined，渲染时留空）

  // ── § 3.4 多维标签（战略支柱①：自由标签体系） ───────────
  /**
   * tags — 多维度标签数组
   * 不受分类体系约束，用于跨分类的横向聚合
   * 示例：['年度旅行', '报销', '日本大阪', '团队活动']
   * 未来支持标签过滤、标签云、按标签汇总报表
   */
  tags: string[]

  // ── § 3.5 资金账户（战略支柱①：资金性质维度） ───────────
  /**
   * accountId — 资金账户 ID（关联 Account 集合）
   * 记录这笔钱"从哪个账户出/入"
   * 示例：'acc-wechat-balance'（微信零钱）/ 'acc-alipay-huabei'（花呗）
   * CSV 解析时通过 guessAccountId() 自动推断，OCR 和手动录入由用户选择
   */
  accountId: string

  // ── § 3.6 录入方式与溯源（战略支柱②：手写体 OCR 支持） ──
  /**
   * sourceType — 录入方式（与 source 字段互补）
   * source  = 来自哪个平台（微信/支付宝/银行/手动）
   * sourceType = 用哪种方式录入（CSV/OCR拍照/语音/表单）
   */
  sourceType: SourceType

  /** 原始数据平台标识 */
  source: TransactionSource

  /**
   * rawData — 原始行数据（解析时从 CSV/OCR 原始输入完整保留）
   * 用于出现问题时的数据回溯，任何情况下不得覆盖
   */
  rawData: Record<string, unknown>

  /**
   * originalParsedData — AI/解析器的【首次识别结果】存档
   * 与 rawData 的区别：
   *   rawData          = 未经处理的原始文本（CSV 的列值 / OCR 的原始识别字符串）
   *   originalParsedData = 解析器/AI 对 rawData 的【第一次解读结果】
   *
   * 使用场景：用户修正了金额或分类后，仍可点击"查看原始识别"回看 AI 的判断
   * 这对 OCR 手写单据尤其重要：便于发现 AI 系统性识别错误并优化模型
   */
  originalParsedData?: Record<string, unknown>

  /**
   * isManuallyEdited — 该记录是否经过人工修正
   * false（默认）= 保持解析器/AI 的原始输出
   * true         = 用户手动修改过至少一个字段
   * 用途：统计 AI 准确率、触发"溯及既往"决策弹窗
   */
  isManuallyEdited?: boolean

  // ── § 3.7 OCR 专用字段（战略支柱②，sourceType='ocr' 时生效） ──
  /**
   * ocrStatus — OCR 识别工作流的当前状态
   * 驱动 S6 阶段的"待核对"列表 UI
   */
  ocrStatus?: OcrStatus

  /**
   * ocrConfidence — 整体识别置信度（0-1）
   * 低于某阈值（建议 0.85）时，UI 自动标记为"需要人工核查"
   */
  ocrConfidence?: number

  /**
   * ocrDoubtSpans — 字段级"识别存疑"区域列表
   * S6 阶段 UI 将据此在字段旁渲染黄色高亮，点击弹出原图切片对比
   */
  ocrDoubtSpans?: OcrDoubtSpan[]

  // ── § 3.8 数据质量标记 ────────────────────────────────────
  parseError?:  string    // 解析错误描述（有值=某字段解析失败）
  isDuplicate?: boolean   // 疑似重复标记（人工确认后清除）
  isVerified?:  boolean   // 人工核实完成标记

  // ── § 3.9b 凭证图片（V2 历史迁移 + 未来拍照附件） ────────────
  /**
   * receiptUrls — 账单附件图片 URL 数组
   *
   * 来源：
   *   · V2 → V3 迁移：migrateV2toV3.js 将 V2 voucher 图片
   *     下载后上传至 V3 Storage，新 URL 写入此字段
   *   · 未来 S10+ 拍照记账：用户录入时拍照，图片存此字段
   *
   * 存储路径约定：
   *   receipts/{ledgerId}/{transactionId}/{filename}
   *
   * 上限建议 10 张（UI 层校验，Service 层不强制）
   * 空数组 [] 与 undefined 等价，写 Firestore 时省略此字段即可
   */
  receiptUrls?: string[]

    // ── § 3.10 预支出与平替基因 ──────────────────────────────
  /**
   * status — 账单的生命周期状态
   *
   * expected  : 预支出 / 待发生 — 已录入但尚未实际产生的交易
   *             典型场景：预订房间后先记一笔，实际到账再 cleared；
   *             或"计划本月还花呗"先记，还款后更新为 cleared
   * cleared   : 已结清 — 交易已实际发生（默认状态）
   * void      : 已作废 — 该笔记录无效（如预支出取消、重复录入）
   *
   * status 与金额的关系：
   *   expected 状态的账单参与"未来预算"统计，
   *   不纳入"已实现净收支"（前端 useBills 需按此过滤）
   *
   * S8 阶段实现"预支出管理"UI 面板
   */
  status: 'expected' | 'cleared' | 'void'

  /**
   * offsetByTxId — 指向"抵消"此笔账单的目标账单 ID
   *
   * 平替/对冲场景：
   *   A: 某员工垫资出差（expense, status='cleared'）
   *   B: 公司报销到账（income, status='cleared', offsetByTxId = A.id）
   *   → UI 可将 A-B 聚合展示为"已报销"，净额为 0
   *
   *   也可用于"货款未到先记 expected → 到账后新建 cleared 并 offset 原记录"
   *
   * 注：offsetByTxId 不做跨账套引用，若需跨账套对冲请使用 clonedFromId 血缘链
   */
  offsetByTxId?: string

  // ── § 3.9 跨账套数据血缘（Data Pedigree） ────────────────
  /**
   * clonedFromId — 该记录克隆自哪条原始记录的 ID
   *
   * 使用场景：将账套 A 的一条账单"克隆"到账套 B 时，
   *   账套 B 中的新记录携带此字段，指向账套 A 中原记录的 Firestore 文档 ID。
   *
   * 查询用法：可通过 clonedFromId 反查所有"派生自同一原始记录"的副本，
   *   用于跨账套对账、凭证一致性验证。
   *
   * SX 阶段实现完整血缘追溯 UI。
   */
  clonedFromId?: string

  /**
   * sourceLedgerId — 该记录克隆自哪个账套
   *
   * 与 clonedFromId 成对使用：
   *   clonedFromId  = 原始记录的 Firestore 文档 ID（定位到具体记录）
   *   sourceLedgerId = 原始记录所在的账套 ID（定位到来源空间）
   *
   * 之所以单独存储 sourceLedgerId（而非运行时从 clonedFromId 反查），
   *   是因为 Firestore 安全规则会限制跨账套读取，
   *   冗余存储可在仅有本账套权限时也能展示来源标签。
   *
   * 示例：{ clonedFromId: 'txn-abc123', sourceLedgerId: 'mingpao-ca' }
   */
  sourceLedgerId?: string
}

// ════════════════════════════════════════════════════════════
// § 4  派生类型
// ════════════════════════════════════════════════════════════

/**
 * TransactionInput — 新建账单时的调用方输入
 * 排除系统自动生成字段，ledgerId/userId 由 Service 层注入
 */
export type TransactionInput = Omit<
  Transaction,
  'id' | 'createdAt' | 'updatedAt' | 'ledgerId' | 'userId'
>

/**
 * TransactionUpdate — 更新账单时允许修改的字段
 * 隔离键和系统字段不可通过此类型修改
 * isManuallyEdited 由 Service 层自动设为 true（不需调用方传入）
 */
export type TransactionUpdate = Partial<
  Pick<Transaction,
    | 'date' | 'amount' | 'category' | 'subCategory' | 'description' | 'remark'
    | 'tags' | 'accountId' | 'status'
    | 'isVerified' | 'isDuplicate' | 'ocrStatus'
  >
>

// ════════════════════════════════════════════════════════════
// § 5  补录决策策略（战略支柱①：溯及既往）
// ════════════════════════════════════════════════════════════

/**
 * CorrectionPolicy — 修改分类/标签时的生效范围策略
 * 当用户修改一条账单的分类或标签时，系统弹出此决策：
 *
 * once        : 仅修改本条记录（默认最安全）
 * rule_forward: 创建规则，新导入的相似记录自动应用
 * retroactive : 溯及既往，同时修改历史上所有相似记录（危险操作，需二次确认）
 *
 * S7 阶段实现此功能的 UI 弹窗和后端逻辑
 */
export type CorrectionPolicy = 'once' | 'rule_forward' | 'retroactive'

/**
 * CorrectionIntent — 用户的修正操作记录
 * 传给 Service 层，由 Service 层根据 policy 决定写入范围
 */
export interface CorrectionIntent {
  transactionId: string            // 被修正的账单 ID
  field:         keyof TransactionUpdate // 被修正的字段
  oldValue:      unknown           // 修正前的值（用于溯及既往时精确匹配）
  newValue:      unknown           // 修正后的值
  policy:        CorrectionPolicy  // 生效范围策略
  matchRule?:    string            // 溯及既往时的匹配规则（如描述包含"美团"）
}
