// governanceService — 账单治理操作服务 (S21)
// 封装强制入账、作废、合并三种治理动作的 Firestore 写入逻辑
// 每次操作均向 transactionVersions 集合写入变更快照（审计追踪）
//
// 数据流：Service 写 Firestore → onSnapshot → billStore → UI 自动更新
// 调用方不得手动修改本地 Store（严守单向数据流）

import {
  doc, getDoc, addDoc,
  updateDoc, writeBatch,
  getDocs, query, where,
  collection, serverTimestamp,
} from 'firebase/firestore'
import { db }                   from '@/config/firebase'
import { softUnbindEvidence }   from '@/services/firebase/evidenceService'
import type { Transaction }     from '@/types/Transaction.types'
import type { VersionChangeType } from '@/types/TransactionVersion.types'

// ════════════════════════════════════════════════════════════════
// § 1  内部工具：写版本记录
// ════════════════════════════════════════════════════════════════

/**
 * writeVersionRecord — 向 transactionVersions 集合写入一条变更快照
 *
 * @param transactionId 被操作的账单 ID
 * @param ledgerId      所属账套 ID（用于后续按账套查询版本历史）
 * @param changeType    操作类型
 * @param before        操作前的账单完整快照
 * @param after         操作后的账单完整快照
 * @param operatorUid   操作者 Firebase Auth UID
 */
async function writeVersionRecord(
  transactionId: string,
  ledgerId:      string,
  changeType:    VersionChangeType,
  before:        Record<string, unknown>,
  after:         Record<string, unknown>,
  operatorUid:   string,
): Promise<void> {
  await addDoc(collection(db, 'transactionVersions'), {
    transactionId,
    ledgerId,
    changeType,
    before,
    after,
    operatorUid,
    operatedAt: serverTimestamp(),
  })
  console.debug(`[governanceService] 版本记录已写入 txId=${transactionId} type=${changeType}`)
}

// ════════════════════════════════════════════════════════════════
// § 2  强制入账
// ════════════════════════════════════════════════════════════════

// ── 迁移状态枚举 ─────────────────────────────────────────────
// V2_COMPLETE  : 文字 + 物理凭证均完整，处于合规状态
// V2_TEXT_ONLY : 仅有文字占位，无物理凭证，属于"待补救件"
export type MigrationStatus = 'V2_COMPLETE' | 'V2_TEXT_ONLY'

/** 根据账单数据自动推断迁移路径 A（有凭证）或路径 B（无凭证） */
function resolveMigrationStatus(data: Record<string, unknown>): MigrationStatus | null {
  const rawData    = (typeof data['rawData'] === 'object' && data['rawData'] !== null)
    ? (data['rawData'] as Record<string, unknown>)
    : {}
  if (rawData['_migratedFromV2'] !== true) return null   // 非迁移数据，不打标
  const hasVoucher = Array.isArray(data['receiptUrls']) &&
    (data['receiptUrls'] as unknown[]).length > 0
  return hasVoucher ? 'V2_COMPLETE' : 'V2_TEXT_ONLY'
}

/**
 * forceAdd — 强制入账
 *
 * 清除 isDuplicate 标记，设置 isVerified=true，将 status 置为 cleared。
 * 若为 V2 迁移账单，自动在 rawData 写入分流标记：
 *   · 有凭证 → migrationStatus='V2_COMPLETE', hasPhysicalVoucher=true
 *   · 无凭证 → migrationStatus='V2_TEXT_ONLY', hasPhysicalVoucher=false
 *
 * @param txId        目标账单 Firestore 文档 ID
 * @param operatorUid 操作者 UID（写入版本记录）
 */
export async function forceAdd(txId: string, operatorUid: string): Promise<void> {
  const ref  = doc(db, 'transactions', txId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`账单 ${txId} 不存在`)

  const before     = snap.data() as Record<string, unknown>
  const existingRaw: Record<string, unknown> =
    (typeof before['rawData'] === 'object' && before['rawData'] !== null)
      ? (before['rawData'] as Record<string, unknown>)
      : {}

  // 自动推断 A/B 路径并打标
  const status    = resolveMigrationStatus(before)
  const migration = status !== null ? {
    migrationStatus:    status,
    hasPhysicalVoucher: status === 'V2_COMPLETE',
  } : {}

  const patch: Record<string, unknown> = {
    isDuplicate: false,
    isVerified:  true,
    status:      'cleared',
    rawData:     { ...existingRaw, ...migration },
    updatedAt:   Date.now(),
  }

  await updateDoc(ref, patch)
  await writeVersionRecord(
    txId,
    String(before['ledgerId'] ?? ''),
    'force_add',
    before,
    { ...before, ...patch },
    operatorUid,
  )
  console.debug(
    `[governanceService] 强制入账完成 txId=${txId}` +
    (status ? ` migrationStatus=${status}` : '')
  )
}

// ════════════════════════════════════════════════════════════════
// § 2b  批量强制入账（待验证队列专用）
// ════════════════════════════════════════════════════════════════

export interface BatchForceAddResult {
  succeeded:     number
  failed:        number
  completeCount: number   // 路径 A：V2_COMPLETE（有凭证）
  textOnlyCount: number   // 路径 B：V2_TEXT_ONLY（无凭证）
  errors:        string[]
}

/**
 * batchForceAdd — 批量强制入账
 *
 * 并发读取全部账单 → writeBatch 原子提交主字段 → 并发写版本记录
 * 自动为每条 V2 迁移账单打 A/B 分流标记（V2_COMPLETE / V2_TEXT_ONLY）
 *
 * @param txIds       目标账单 ID 数组
 * @param operatorUid 操作者 UID
 */
export async function batchForceAdd(
  txIds:        string[],
  operatorUid:  string,
): Promise<BatchForceAddResult> {
  if (txIds.length === 0) return { succeeded: 0, failed: 0, completeCount: 0, textOnlyCount: 0, errors: [] }

  // ── 并发读取所有账单快照 ──────────────────────────────────────
  const snaps = await Promise.all(txIds.map(id => getDoc(doc(db, 'transactions', id))))

  const result: BatchForceAddResult = { succeeded: 0, failed: 0, completeCount: 0, textOnlyCount: 0, errors: [] }
  const BATCH_LIMIT = 499
  const chunks = []
  for (let i = 0; i < snaps.length; i += BATCH_LIMIT) chunks.push(snaps.slice(i, i + BATCH_LIMIT))

  for (const chunk of chunks) {
    const batch   = writeBatch(db)
    const metas: Array<{ txId: string; before: Record<string, unknown>; patch: Record<string, unknown> }> = []

    for (const snap of chunk) {
      if (!snap.exists()) { result.failed++; result.errors.push(`${snap.id} 不存在`); continue }
      const before      = snap.data() as Record<string, unknown>
      const existingRaw = (typeof before['rawData'] === 'object' && before['rawData'] !== null)
        ? (before['rawData'] as Record<string, unknown>) : {}
      const status      = resolveMigrationStatus(before)
      const migration   = status !== null ? {
        migrationStatus:    status,
        hasPhysicalVoucher: status === 'V2_COMPLETE',
      } : {}
      const patch: Record<string, unknown> = {
        isDuplicate: false, isVerified: true, status: 'cleared',
        rawData: { ...existingRaw, ...migration }, updatedAt: Date.now(),
      }
      batch.update(doc(db, 'transactions', snap.id), patch)
      metas.push({ txId: snap.id, before, patch })
      if (status === 'V2_COMPLETE')  result.completeCount++
      else if (status === 'V2_TEXT_ONLY') result.textOnlyCount++
    }

    try {
      await batch.commit()
      result.succeeded += metas.length
      // 版本记录并发写入（不阻塞主流程）
      void Promise.all(metas.map(({ txId, before, patch }) =>
        writeVersionRecord(
          txId, String(before['ledgerId'] ?? ''), 'force_add',
          before, { ...before, ...patch }, operatorUid,
        ).catch(e => console.warn(`[governanceService] 版本记录写入失败 txId=${txId}`, e))
      ))
    } catch (e) {
      result.failed += metas.length
      result.errors.push(e instanceof Error ? e.message : '批量提交失败')
    }
  }

  console.debug(
    `[governanceService] 批量强制入账完成 成功=${result.succeeded} 失败=${result.failed}` +
    ` V2_COMPLETE=${result.completeCount} V2_TEXT_ONLY=${result.textOnlyCount}`
  )
  return result
}

// ════════════════════════════════════════════════════════════════
// § 3  作废
// ════════════════════════════════════════════════════════════════

/**
 * archiveTransaction — 作废账单
 *
 * 将 status 置为 'void'，账单不再参与统计但保留原始数据（可通过版本记录追溯）。
 * 适用场景：确认为重复数据、迁移残留无效记录等。
 *
 * @param txId        目标账单 Firestore 文档 ID
 * @param operatorUid 操作者 UID
 */
export async function archiveTransaction(txId: string, operatorUid: string): Promise<void> {
  const ref  = doc(db, 'transactions', txId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`账单 ${txId} 不存在`)

  const before = snap.data() as Record<string, unknown>
  const patch: Record<string, unknown> = {
    status:    'void',
    updatedAt: Date.now(),
  }

  await updateDoc(ref, patch)
  await writeVersionRecord(
    txId,
    String(before['ledgerId'] ?? ''),
    'archive',
    before,
    { ...before, ...patch },
    operatorUid,
  )
  console.debug(`[governanceService] 已作废 txId=${txId}`)
}

// ════════════════════════════════════════════════════════════════
// § 4  合并
// ════════════════════════════════════════════════════════════════

/**
 * mergeTransactions — 合并两条账单
 *
 * 将 removeId 的 tags、receiptUrls 合并到 keepId（去重联合），
 * 随后将 removeId 状态置为 'void'，通过 writeBatch 原子提交。
 * 两条账单各写一条版本记录（merge_keep / merge_remove）。
 *
 * @param keepId      保留方账单 ID（合并完成后继续生效）
 * @param removeId    被合并方账单 ID（合并完成后作废）
 * @param operatorUid 操作者 UID
 *
 * @throws 若任一账单不存在则抛出错误（批量操作不执行）
 */
export async function mergeTransactions(
  keepId:      string,
  removeId:    string,
  operatorUid: string,
): Promise<void> {
  // ── 并发读取两条账单原始数据 ──────────────────────────────────
  const [keepSnap, removeSnap] = await Promise.all([
    getDoc(doc(db, 'transactions', keepId)),
    getDoc(doc(db, 'transactions', removeId)),
  ])
  if (!keepSnap.exists())   throw new Error(`保留账单 ${keepId} 不存在`)
  if (!removeSnap.exists()) throw new Error(`被合并账单 ${removeId} 不存在`)

  const keepData   = keepSnap.data()   as Transaction
  const removeData = removeSnap.data() as Transaction
  const ledgerId   = keepData.ledgerId

  // ── 合并 tags（去重联合）──────────────────────────────────────
  const mergedTags = Array.from(new Set([
    ...(keepData.tags    ?? []),
    ...(removeData.tags  ?? []),
  ]))

  // ── 合并 receiptUrls（去重联合）──────────────────────────────
  const mergedReceipts = Array.from(new Set([
    ...(keepData.receiptUrls    ?? []),
    ...(removeData.receiptUrls  ?? []),
  ]))

  // ── 构建写入 patch ────────────────────────────────────────────
  const keepPatch: Record<string, unknown> = {
    tags:        mergedTags,
    receiptUrls: mergedReceipts,
    isVerified:  true,
    isDuplicate: false,
    updatedAt:   Date.now(),
  }
  const removePatch: Record<string, unknown> = {
    status:    'void',
    updatedAt: Date.now(),
  }

  // ── 原子批量写入 ──────────────────────────────────────────────
  const batch = writeBatch(db)
  batch.update(doc(db, 'transactions', keepId),   keepPatch)
  batch.update(doc(db, 'transactions', removeId), removePatch)
  await batch.commit()

  // ── 写版本记录（两条，各记录操作前后快照）────────────────────
  const beforeKeep   = keepSnap.data()   as Record<string, unknown>
  const beforeRemove = removeSnap.data() as Record<string, unknown>
  await Promise.all([
    writeVersionRecord(
      keepId, ledgerId, 'merge_keep',
      beforeKeep,
      { ...beforeKeep,   ...keepPatch },
      operatorUid,
    ),
    writeVersionRecord(
      removeId, ledgerId, 'merge_remove',
      beforeRemove,
      { ...beforeRemove, ...removePatch },
      operatorUid,
    ),
  ])

  console.debug(
    `[governanceService] 合并完成 keep=${keepId} remove=${removeId}` +
    ` tags合并后=${mergedTags.length}条 receipts合并后=${mergedReceipts.length}张`
  )
}

// ════════════════════════════════════════════════════════════════
// § 5  无凭证强行入账
// ════════════════════════════════════════════════════════════════

/**
 * confirmNoEvidence — 无凭证强行入账
 *
 * 适用场景：用户确认该条迁移账单确实无凭证可补，选择忽略警告强制入账。
 *
 * 操作效果：
 *   · isVerified = true               — 账单已核实
 *   · status = 'cleared'              — 确认入账
 *   · tags 追加 '无凭证'              — 打标，便于后续筛选
 *   · rawData._noEvidenceConfirmed = true — 内部标记，令 detectConflicts 跳过此账单
 *   · 写版本记录（复用 force_add 类型）
 *
 * @param txId        目标账单 Firestore 文档 ID
 * @param operatorUid 操作者 UID
 */
export async function confirmNoEvidence(txId: string, operatorUid: string): Promise<void> {
  const txRef = doc(db, 'transactions', txId)
  const snap  = await getDoc(txRef)
  if (!snap.exists()) throw new Error(`账单 ${txId} 不存在`)

  const before     = snap.data() as Record<string, unknown>
  const existingTags = Array.isArray(before['tags']) ? (before['tags'] as string[]) : []
  const existingRaw  = (typeof before['rawData'] === 'object' && before['rawData'] !== null)
    ? (before['rawData'] as Record<string, unknown>)
    : {}

  // 缺凭证队列强行入账 → 固定为 V2_TEXT_ONLY 路径 B
  const patch: Record<string, unknown> = {
    isVerified: true,
    status:     'cleared',
    tags:       [...new Set([...existingTags, '无凭证'])],
    rawData:    {
      ...existingRaw,
      _noEvidenceConfirmed: true,
      migrationStatus:      'V2_TEXT_ONLY' as MigrationStatus,
      hasPhysicalVoucher:   false,
    },
    updatedAt:  Date.now(),
  }

  await updateDoc(txRef, patch)
  await writeVersionRecord(
    txId,
    String(before['ledgerId'] ?? ''),
    'force_add',
    before,
    { ...before, ...patch },
    operatorUid,
  )
  console.debug(`[governanceService] 无凭证强行入账完成 txId=${txId}`)
}

// ════════════════════════════════════════════════════════════════
// § 6  补传凭证后更新账单 receiptUrls
// ════════════════════════════════════════════════════════════════

/**
 * attachEvidenceUrl — 将新上传凭证的 Storage URL 追加到账单 receiptUrls
 *
 * 配合 evidenceService.uploadEvidence() 使用：
 *   1. 先调用 uploadEvidence() 上传文件，拿到 Evidence.storageUrl
 *   2. 再调用本函数更新 Transaction.receiptUrls
 *   3. 更新后账单满足 receiptUrls.length > 0 → detectConflicts 移出 no_evidence 队列
 *
 * @param txId        目标账单 Firestore 文档 ID
 * @param storageUrl  uploadEvidence 返回的 Firebase Storage 公开下载 URL
 * @param operatorUid 操作者 UID
 */
export async function attachEvidenceUrl(
  txId:        string,
  storageUrl:  string,
  operatorUid: string,
): Promise<void> {
  const txRef = doc(db, 'transactions', txId)
  const snap  = await getDoc(txRef)
  if (!snap.exists()) throw new Error(`账单 ${txId} 不存在`)

  const before       = snap.data() as Record<string, unknown>
  const existingUrls = Array.isArray(before['receiptUrls']) ? (before['receiptUrls'] as string[]) : []

  const patch: Record<string, unknown> = {
    receiptUrls: [...new Set([...existingUrls, storageUrl])],
    updatedAt:   Date.now(),
  }

  await updateDoc(txRef, patch)
  await writeVersionRecord(
    txId,
    String(before['ledgerId'] ?? ''),
    'field_update',
    before,
    { ...before, ...patch },
    operatorUid,
  )
  console.debug(`[governanceService] 凭证 URL 已绑定 txId=${txId} url=${storageUrl.slice(0, 60)}…`)
}

// ════════════════════════════════════════════════════════════════
// § 7  凭证解绑（含历史回改规则）
// ════════════════════════════════════════════════════════════════

/**
 * unbindEvidence — 软解绑一张凭证（移入凭证池），执行版本审计记录
 *
 * ⚠️  行为变更（Soft Unbind）：
 *   凭证不再物理删除，而是置为 orphan 状态保留在凭证池，
 *   方便后续重新挂载到其他账单，或由凭证池管理员手动硬删。
 *
 * 执行步骤：
 *   1. 读取账单操作前快照（供写版本记录用）
 *   2. 调用 softUnbindEvidence()，完成状态机迁移 + receiptUrls 更新 + 历史回改
 *   3. 读取账单操作后快照
 *   4. 写入 transactionVersions 审计记录（before/after 完整快照）
 *
 * @param evidenceId  Firestore evidences 文档 ID
 * @param txId        关联账单的 Firestore 文档 ID
 * @param operatorUid 操作者 Firebase Auth UID
 */
export async function unbindEvidence(
  evidenceId:  string,
  txId:        string,
  operatorUid: string,
): Promise<void> {
  // ── 步骤 1：读取账单操作前快照 ────────────────────────────────
  const txRef  = doc(db, 'transactions', txId)
  const txSnap = await getDoc(txRef)
  if (!txSnap.exists()) throw new Error(`账单 ${txId} 不存在`)
  const txBefore = txSnap.data() as Record<string, unknown>
  const ledgerId = String(txBefore['ledgerId'] ?? '')

  // ── 步骤 2：软解绑（状态机迁移 + receiptUrls 更新 + 历史回改）──
  // softUnbindEvidence 内部处理：evidence → orphan，arrayRemove URL，isVerified 回退
  await softUnbindEvidence(evidenceId, txId)

  // ── 步骤 3：读取账单操作后快照 ────────────────────────────────
  const txAfterSnap = await getDoc(txRef)
  const txAfter     = txAfterSnap.exists()
    ? (txAfterSnap.data() as Record<string, unknown>)
    : { ...txBefore }

  // ── 步骤 4：写版本记录（审计追踪）───────────────────────────
  await writeVersionRecord(
    txId,
    ledgerId,
    'field_update',
    txBefore,
    txAfter,
    operatorUid,
  )

  console.debug(
    `[governanceService] 凭证软解绑完成 evId=${evidenceId} txId=${txId} → 凭证池`
  )
}

// ════════════════════════════════════════════════════════════════
// § 8  批量无凭证强行入账（缺凭证队列专用）
// ════════════════════════════════════════════════════════════════

export interface BatchNoEvidenceResult {
  succeeded: number
  failed:    number
  errors:    string[]
}

/**
 * batchConfirmNoEvidence — 批量无凭证强行入账
 *
 * 路径 B 专用：统一打 V2_TEXT_ONLY + hasPhysicalVoucher=false
 * 方便后续通过 migrationStatus 筛选"无头账单"进行照片补录。
 *
 * @param txIds       目标账单 ID 数组
 * @param operatorUid 操作者 UID
 */
export async function batchConfirmNoEvidence(
  txIds:        string[],
  operatorUid:  string,
): Promise<BatchNoEvidenceResult> {
  if (txIds.length === 0) return { succeeded: 0, failed: 0, errors: [] }

  const snaps = await Promise.all(txIds.map(id => getDoc(doc(db, 'transactions', id))))
  const result: BatchNoEvidenceResult = { succeeded: 0, failed: 0, errors: [] }
  const BATCH_LIMIT = 499
  const chunks = []
  for (let i = 0; i < snaps.length; i += BATCH_LIMIT) chunks.push(snaps.slice(i, i + BATCH_LIMIT))

  for (const chunk of chunks) {
    const batch = writeBatch(db)
    const metas: Array<{ txId: string; before: Record<string, unknown>; patch: Record<string, unknown> }> = []

    for (const snap of chunk) {
      if (!snap.exists()) { result.failed++; result.errors.push(`${snap.id} 不存在`); continue }
      const before       = snap.data() as Record<string, unknown>
      const existingTags = Array.isArray(before['tags']) ? (before['tags'] as string[]) : []
      const existingRaw  = (typeof before['rawData'] === 'object' && before['rawData'] !== null)
        ? (before['rawData'] as Record<string, unknown>) : {}
      const patch: Record<string, unknown> = {
        isVerified: true, status: 'cleared',
        tags:       [...new Set([...existingTags, '无凭证'])],
        rawData:    {
          ...existingRaw,
          _noEvidenceConfirmed: true,
          migrationStatus:      'V2_TEXT_ONLY' as MigrationStatus,
          hasPhysicalVoucher:   false,
        },
        updatedAt: Date.now(),
      }
      batch.update(doc(db, 'transactions', snap.id), patch)
      metas.push({ txId: snap.id, before, patch })
    }

    try {
      await batch.commit()
      result.succeeded += metas.length
      void Promise.all(metas.map(({ txId, before, patch }) =>
        writeVersionRecord(
          txId, String(before['ledgerId'] ?? ''), 'force_add',
          before, { ...before, ...patch }, operatorUid,
        ).catch(e => console.warn(`[governanceService] 版本记录写入失败 txId=${txId}`, e))
      ))
    } catch (e) {
      result.failed += metas.length
      result.errors.push(e instanceof Error ? e.message : '批量提交失败')
    }
  }

  console.debug(
    `[governanceService] 批量无凭证入账完成 成功=${result.succeeded} 失败=${result.failed}`
  )
  return result
}
