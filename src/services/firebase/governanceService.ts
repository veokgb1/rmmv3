// governanceService — 账单治理操作服务 (S21)
// 封装强制入账、作废、合并三种治理动作的 Firestore 写入逻辑
// 每次操作均向 transactionVersions 集合写入变更快照（审计追踪）
//
// 数据流：Service 写 Firestore → onSnapshot → billStore → UI 自动更新
// 调用方不得手动修改本地 Store（严守单向数据流）

import {
  doc, getDoc, addDoc,
  updateDoc, writeBatch,
  collection, serverTimestamp,
} from 'firebase/firestore'
import { db }                   from '@/config/firebase'
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

/**
 * forceAdd — 强制入账
 *
 * 清除 isDuplicate 标记，设置 isVerified=true，将 status 置为 cleared。
 * 适用场景：人工核查后确认该条账单并非重复，强制放行。
 *
 * @param txId        目标账单 Firestore 文档 ID
 * @param operatorUid 操作者 UID（写入版本记录）
 */
export async function forceAdd(txId: string, operatorUid: string): Promise<void> {
  const ref  = doc(db, 'transactions', txId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`账单 ${txId} 不存在`)

  const before = snap.data() as Record<string, unknown>
  const patch: Record<string, unknown> = {
    isDuplicate: false,
    isVerified:  true,
    status:      'cleared',
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
  console.debug(`[governanceService] 强制入账完成 txId=${txId}`)
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
