// 凭证（附件）数据类型定义 — S21 治理模块
// 对应 Firestore evidences 子集合文档结构

// ════════════════════════════════════════════════════════════════
// § 1  凭证状态枚举
// ════════════════════════════════════════════════════════════════

/**
 * EvidenceStatus — 凭证当前状态机
 *
 * ┌──────────────┐  上传完成（从未关联）   ┌─────────────┐
 * │ uploading    │ ───────────────────────→ │ unprocessed │  Pool A（待处理收件箱）
 * └──────────────┘                          └─────────────┘
 *                                                 │ attachEvidenceUrl
 *                                                 ▼
 * ok        : 已关联到账单，文件可访问          ┌──────┐
 * missing   : 引用存在但 Storage 文件不可访问   │  ok  │
 * uploading : 上传中（前端临时态，不持久化）    └──────┘
 * error     : 上传失败或文件损坏                  │ softUnbindEvidence
 * unprocessed: 新上传但尚未关联任何账单(Pool A)   ▼
 * orphan    : 曾关联账单，被用户主动解绑(Pool B) ┌────────┐
 * replaced  : 曾关联账单，账单合并后被替换(Pool B)│ orphan │
 *                                               │replaced│
 *                                               └────────┘
 *                                                 │ hardDeleteEvidence（仅凭证池 UI）
 *                                                 ▼
 *                                              [已删除]
 */
export type EvidenceStatus =
  | 'ok'
  | 'missing'
  | 'uploading'
  | 'error'
  | 'unprocessed'
  | 'orphan'
  | 'replaced'

// ════════════════════════════════════════════════════════════════
// § 2  凭证记录
// ════════════════════════════════════════════════════════════════

export interface Evidence {
  /** Firestore 文档 ID（由 addDoc 自动生成）*/
  id: string

  /** 关联的账单 ID（transactions/{transactionId}）*/
  transactionId: string

  /** 所属账套 ID（Firestore 查询隔离键）*/
  ledgerId: string

  /** 上传者 Firebase Auth UID */
  uploadedBy: string

  /** 原始文件名 */
  fileName: string

  /** Firebase Storage 下载 URL */
  storageUrl: string

  /**
   * Firebase Storage 存储路径
   * 约定格式：receipts/{ledgerId}/{transactionId}/{fileName}
   */
  storagePath: string

  /** MIME 类型（如 image/jpeg / application/pdf）*/
  fileType: string

  /** 文件大小（字节）*/
  fileSizeBytes: number

  /** 首次上传时间戳（毫秒）*/
  uploadedAt: number

  /** 凭证状态 */
  status: EvidenceStatus

  /**
   * 软解绑时间戳（毫秒）
   * 仅 orphan / replaced 状态有值，记录从账单解绑的时刻
   */
  orphanedAt?: number

  /**
   * 原始关联账单 ID
   * 软解绑后保留，用于凭证池追踪"此凭证来自哪张账单"
   * 仅 orphan / replaced 状态有值
   */
  originalTxId?: string

  /** 可选备注（如：原始单据编号、备注说明）*/
  note?: string
}

// ════════════════════════════════════════════════════════════════
// § 3  派生类型
// ════════════════════════════════════════════════════════════════

/** 新增凭证时调用方传入的字段（排除系统自动生成字段）*/
export type EvidenceInput = Omit<Evidence, 'id' | 'uploadedAt' | 'status'>
