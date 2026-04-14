// evidenceService — 凭证 Firebase 读写服务 (S21)
// 封装 evidences 集合（Firestore）与 Storage 文件的完整生命周期
//
// Firestore 集合：evidences（扁平集合，按 transactionId 查询）
// Storage 路径约定：receipts/{ledgerId}/{transactionId}/{timestamp}_{fileName}
//
// 数据流：UI 调用 → Service 写 Firestore/Storage → onSnapshot → UI 自动更新

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage'
import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, getDoc, getDocs,
  updateDoc, arrayRemove, arrayUnion,
  type Unsubscribe,
} from 'firebase/firestore'
import { db, storage }   from '@/config/firebase'
import type { Evidence } from '@/types/Evidence.types'

// ════════════════════════════════════════════════════════════════
// § 1  文件合法性校验常量
// ════════════════════════════════════════════════════════════════

/** 允许上传的 MIME 类型前缀（图片全系列 + PDF）*/
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf'] as const

/** 单文件体积上限：10 MB */
const MAX_FILE_BYTES = 10 * 1024 * 1024

export interface FileValidationResult {
  valid:   boolean
  message: string
}

/**
 * validateFile — 校验待上传文件是否合法
 * 调用方应在加入上传队列前调用此函数，不合法的文件拒绝入队
 */
export function validateFile(file: File): FileValidationResult {
  if (!ALLOWED_MIME_PREFIXES.some(prefix => file.type.startsWith(prefix))) {
    return {
      valid:   false,
      message: `不支持的文件类型（${file.type || '未知'}），仅接受图片或 PDF`,
    }
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      valid:   false,
      message: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单文件上限 10 MB`,
    }
  }
  if (file.size === 0) {
    return { valid: false, message: '文件内容为空，请重新选择' }
  }
  return { valid: true, message: '' }
}

// ════════════════════════════════════════════════════════════════
// § 2  Storage 路径构建
// ════════════════════════════════════════════════════════════════

/**
 * buildStoragePath — 构建 Firebase Storage 存储路径
 * 加入时间戳前缀避免同名文件覆盖（同一账单可多次上传同名凭证）
 * 过滤 Storage 不允许的特殊字符：# [ ] * ?
 */
function buildStoragePath(ledgerId: string, txId: string, fileName: string): string {
  const sanitized = fileName.replace(/[#[\]*?]/g, '_')
  return `receipts/${ledgerId}/${txId}/${Date.now()}_${sanitized}`
}

// ════════════════════════════════════════════════════════════════
// § 3  上传凭证（含实时进度回调）
// ════════════════════════════════════════════════════════════════

/**
 * uploadEvidence — 上传一个凭证文件并写入 Firestore
 *
 * 执行步骤：
 *   1. 构建 Storage 路径
 *   2. uploadBytesResumable 上传（触发进度回调）
 *   3. getDownloadURL 获取下载链接
 *   4. addDoc 写入 Firestore evidences 集合
 *   5. 返回完整 Evidence 对象（供 UI 立即展示）
 *
 * @param file        待上传的 File 对象（调用前请先用 validateFile 校验）
 * @param txId        关联账单的 Firestore 文档 ID
 * @param ledgerId    所属账套 ID（决定 Storage 路径分区）
 * @param uploadedBy  上传者 Firebase Auth UID
 * @param onProgress  可选：进度回调，参数为 0-100 的整数百分比
 */
export async function uploadEvidence(
  file:        File,
  txId:        string,
  ledgerId:    string,
  uploadedBy:  string,
  onProgress?: (percent: number) => void,
): Promise<Evidence> {
  const storagePath = buildStoragePath(ledgerId, txId, file.name)
  const storageRef  = ref(storage, storagePath)

  // 阶段 1：上传文件到 Firebase Storage（监听进度）
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type })
    task.on(
      'state_changed',
      (snap) => {
        const percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
        onProgress?.(percent)
      },
      reject,   // 上传失败 → reject Promise
      resolve,  // 上传完成 → resolve Promise
    )
  })

  // 阶段 2：获取公开下载 URL
  const storageUrl = await getDownloadURL(storageRef)

  // 阶段 3：写入 Firestore evidences 集合
  // 使用客户端时间戳（Date.now()）保持与 Evidence.uploadedAt: number 类型一致
  const now = Date.now()
  const payload = {
    transactionId: txId,
    ledgerId,
    uploadedBy,
    fileName:      file.name,
    storageUrl,
    storagePath,
    fileType:      file.type,
    fileSizeBytes: file.size,
    uploadedAt:    now,
    status:        'ok' as const,
  }

  const docRef = await addDoc(collection(db, 'evidences'), payload)
  console.debug(`[evidenceService] 凭证已上传 txId=${txId} docId=${docRef.id}`)

  return { id: docRef.id, ...payload }
}

// ════════════════════════════════════════════════════════════════
// § 4  删除凭证（解绑：同时删除 Storage 文件 + Firestore 文档）
// ════════════════════════════════════════════════════════════════

/**
 * deleteEvidence — 彻底删除一条凭证（Storage + Firestore 双删）
 *
 * 容错设计：
 *   若 Storage 文件不存在（V2 迁移残留的 missing 状态凭证），
 *   忽略 storage/object-not-found 错误，继续删除 Firestore 文档
 *   避免"无法解绑"的死锁问题
 *
 * @param evidenceId  Firestore evidences 文档 ID
 * @param storagePath Firebase Storage 存储路径
 */
export async function deleteEvidence(
  evidenceId:  string,
  storagePath: string,
): Promise<void> {
  // 删除 Storage 文件（容错：文件不存在时跳过）
  try {
    await deleteObject(ref(storage, storagePath))
  } catch (e: unknown) {
    const code = (e as Record<string, unknown>)?.['code']
    if (code !== 'storage/object-not-found') throw e
    console.warn(`[evidenceService] Storage 文件不存在，已跳过：${storagePath}`)
  }

  // 删除 Firestore 凭证文档
  await deleteDoc(doc(db, 'evidences', evidenceId))
  console.debug(`[evidenceService] 凭证已解绑 id=${evidenceId}`)
}

// ════════════════════════════════════════════════════════════════
// § 5  实时订阅账单凭证列表
// ════════════════════════════════════════════════════════════════

/**
 * subscribeEvidences — 实时订阅指定账单的所有凭证
 *
 * 使用 onSnapshot 监听 evidences 集合，自动响应上传/删除变更
 * 返回 unsubscribe 函数，组件卸载时调用
 *
 * 排序：按 uploadedAt 升序（最早上传的在前）
 *
 * @param txId     关联账单 ID
 * @param callback 快照回调（每次变更触发）
 */
export function subscribeEvidences(
  txId:     string,
  callback: (evidences: Evidence[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'evidences'),
    where('transactionId', '==', txId),
  )

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map(d => ({ ...d.data(), id: d.id }) as Evidence)
        .sort((a, b) => a.uploadedAt - b.uploadedAt)
      callback(items)
    },
    (err) => {
      console.error('[evidenceService] 凭证订阅错误:', err.message)
    },
  )
}

// ════════════════════════════════════════════════════════════════
// § 6  软解绑凭证（保留至凭证池，不物理删除）
// ════════════════════════════════════════════════════════════════

/** softUnbindEvidence 可携带的来源溯源元数据 */
export interface SoftUnbindMeta {
  orphanReason?:      'manual' | 'replaced'
  orphanFromDate?:     string
  orphanFromCategory?: string
  orphanFromAmount?:   number
}

/**
 * softUnbindEvidence — 将凭证从账单解绑并移入凭证池（软操作）
 *
 * 状态机：ok → orphan
 *
 * @param evidenceId  Firestore evidences 文档 ID
 * @param txId        关联账单 Firestore 文档 ID
 * @param meta        可选的来源溯源元数据（日期/分类/金额/原因）
 */
export async function softUnbindEvidence(
  evidenceId: string,
  txId:       string,
  meta?:      SoftUnbindMeta,
): Promise<void> {
  // 步骤 1：读取凭证文档
  const evRef  = doc(db, 'evidences', evidenceId)
  const evSnap = await getDoc(evRef)
  if (!evSnap.exists()) throw new Error(`凭证 ${evidenceId} 不存在或已被删除`)

  const evData     = evSnap.data() as Record<string, unknown>
  const storageUrl = typeof evData['storageUrl'] === 'string' ? evData['storageUrl'] : ''
  const now        = Date.now()

  // 步骤 2：软更新凭证文档 → orphan 状态（带来源溯源快照）
  await updateDoc(evRef, {
    status:             'orphan',
    transactionId:      '',
    orphanedAt:         now,
    originalTxId:       txId,
    orphanReason:       meta?.orphanReason      ?? 'manual',
    orphanFromDate:     meta?.orphanFromDate     ?? '',
    orphanFromCategory: meta?.orphanFromCategory ?? '',
    orphanFromAmount:   meta?.orphanFromAmount   ?? 0,
  })

  // 步骤 3：从 Transaction.receiptUrls 移除该 URL
  // 若 storageUrl 为空（V2 边缘情况），跳过 arrayRemove，避免写入脏数据
  const txRef = doc(db, 'transactions', txId)
  if (storageUrl) {
    await updateDoc(txRef, {
      receiptUrls: arrayRemove(storageUrl),
      updatedAt:   now,
    })
  } else {
    // storageUrl 为空时只更新时间戳
    await updateDoc(txRef, { updatedAt: now })
    console.warn(`[evidenceService] softUnbindEvidence: storageUrl 为空，跳过 arrayRemove evId=${evidenceId}`)
  }

  // 步骤 4：检查剩余 ok 状态凭证，触发历史回改规则
  const remainingSnap = await getDocs(
    query(
      collection(db, 'evidences'),
      where('transactionId', '==', txId),
      where('status', '==', 'ok'),
    ),
  )
  if (remainingSnap.size === 0) {
    await updateDoc(txRef, { isVerified: false })
    console.debug(`[evidenceService] 剩余凭证为 0，回退 isVerified=false txId=${txId}`)
  }

  console.debug(`[evidenceService] 软解绑完成 evId=${evidenceId} → orphan 凭证池`)
}

// ════════════════════════════════════════════════════════════════
// § 6b  V2 历史数据软解绑（URL-only，无 evidenceId）
// ════════════════════════════════════════════════════════════════

/**
 * softUnbindByUrl — 通过 storageUrl 解绑凭证，兼容 V2 迁移数据
 *
 * 问题背景：
 *   V2 迁移账单的 receiptUrls 有 URL，但 Firestore evidences 集合无对应文档。
 *   subscribeEvidences 返回空 → urlToEvId[url] = undefined → 💔 按钮不显示。
 *
 * 处理逻辑：
 *   1. 先查询 evidences 中是否已有对应文档（transactionId + storageUrl 联合查）
 *   2. 有 → 调用 softUnbindEvidence
 *   3. 无（V2 case）→ 直接创建 orphan 文档 + 移除 URL + 历史回改
 *
 * @param txId       关联账单 Firestore 文档 ID
 * @param storageUrl 要解绑的凭证 URL
 * @param txMeta     账单元数据快照（用于 Pool B 来源溯源展示）
 */
export async function softUnbindByUrl(
  txId:       string,
  storageUrl: string,
  txMeta?:    { date?: string; category?: string; amount?: number; ledgerId?: string },
): Promise<void> {
  const now = Date.now()

  // 步骤 1：查询是否已有 evidences 文档
  const existingSnap = await getDocs(
    query(
      collection(db, 'evidences'),
      where('transactionId', '==', txId),
      where('storageUrl',    '==', storageUrl),
    ),
  )

  if (!existingSnap.empty) {
    // 找到了现有文档 → 走标准软解绑流程
    const evId = existingSnap.docs[0].id
    await softUnbindEvidence(evId, txId, {
      orphanReason:       'manual',
      orphanFromDate:     txMeta?.date     ?? '',
      orphanFromCategory: txMeta?.category ?? '',
      orphanFromAmount:   txMeta?.amount   ?? 0,
    })
    return
  }

  // V2 fallback：无 evidences 文档，手动创建 orphan 记录
  // 从 URL 推断 storagePath（格式：.../o/ENCODED_PATH?alt=media...）
  // 支持 Firebase Storage URL 两种格式：
  //   格式 A: https://firebasestorage.googleapis.com/.../o/ENCODED?alt=media
  //   格式 B: https://storage.googleapis.com/BUCKET/PATH（无编码）
  let storagePath: string
  const firebaseMatch = storageUrl.match(/\/o\/([^?#]+)/)
  if (firebaseMatch?.[1]) {
    try {
      storagePath = decodeURIComponent(firebaseMatch[1])
    } catch {
      storagePath = firebaseMatch[1]  // 解码失败时保留原始字符串
    }
  } else {
    // 格式 B 或无法解析：取 URL pathname 最后一段作为路径标识
    storagePath = new URL(storageUrl).pathname.replace(/^\/[^/]+\//, '') || storageUrl
  }
  const fileName = storagePath.split('/').pop()?.replace(/^\d+_/, '') || 'v2-receipt'

  // 获取 ledgerId（优先从参数，否则从账单文档读取）
  let ledgerId = txMeta?.ledgerId ?? ''
  if (!ledgerId) {
    const txSnap = await getDoc(doc(db, 'transactions', txId))
    ledgerId = String(txSnap.data()?.['ledgerId'] ?? '')
  }

  // 创建 orphan 凭证文档（代表这张 V2 图片的历史记录）
  await addDoc(collection(db, 'evidences'), {
    transactionId:      '',
    ledgerId,
    uploadedBy:         'v2-migration',
    fileName,
    storageUrl,
    storagePath,
    fileType:           'image/jpeg',   // V2 图片默认 JPEG
    fileSizeBytes:      0,              // V2 无法知道原始大小
    uploadedAt:         now,
    status:             'orphan',
    orphanedAt:         now,
    originalTxId:       txId,
    orphanReason:       'manual',
    orphanFromDate:     txMeta?.date     ?? '',
    orphanFromCategory: txMeta?.category ?? '',
    orphanFromAmount:   txMeta?.amount   ?? 0,
  })

  // 步骤 3：从 Transaction.receiptUrls 移除 URL
  const txRef = doc(db, 'transactions', txId)
  await updateDoc(txRef, {
    receiptUrls: arrayRemove(storageUrl),
    updatedAt:   now,
  })

  // 步骤 4：若 receiptUrls 已清空，触发历史回改（isVerified = false）
  const txAfterSnap  = await getDoc(txRef)
  const remaining    = (txAfterSnap.data()?.['receiptUrls'] ?? []) as string[]
  if (remaining.length === 0) {
    await updateDoc(txRef, { isVerified: false })
    console.debug(`[evidenceService] V2 解绑后 receiptUrls 为空，回退 isVerified=false txId=${txId}`)
  }

  console.debug(`[evidenceService] V2 软解绑完成 url=${storageUrl.slice(0, 60)} → orphan 凭证池`)
}

// ════════════════════════════════════════════════════════════════
// § 6c  Pool A 直传（上传新凭证到待处理池，不关联任何账单）
// ════════════════════════════════════════════════════════════════

/**
 * uploadToPool — 将文件直接上传到 Pool A（unprocessed 状态）
 *
 * 与 uploadEvidence 的区别：
 *   · transactionId = ''（不关联账单）
 *   · status = 'unprocessed'（待处理收件箱）
 *   · Storage 路径：receipts/{ledgerId}/pool/{timestamp}_{fileName}
 *
 * @param file        待上传文件
 * @param ledgerId    所属账套 ID
 * @param uploadedBy  上传者 UID
 * @param onProgress  可选进度回调（0-100）
 */
export async function uploadToPool(
  file:        File,
  ledgerId:    string,
  uploadedBy:  string,
  onProgress?: (percent: number) => void,
): Promise<Evidence> {
  const sanitized   = file.name.replace(/[#[\]*?]/g, '_')
  const storagePath = `receipts/${ledgerId}/pool/${Date.now()}_${sanitized}`
  const sRef        = ref(storage, storagePath)

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(sRef, file, { contentType: file.type })
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      resolve,
    )
  })

  const storageUrl = await getDownloadURL(sRef)
  const now        = Date.now()

  const payload = {
    transactionId: '',        // 未关联账单
    ledgerId,
    uploadedBy,
    fileName:      file.name,
    storageUrl,
    storagePath,
    fileType:      file.type,
    fileSizeBytes: file.size,
    uploadedAt:    now,
    status:        'unprocessed' as const,
  }

  const docRef = await addDoc(collection(db, 'evidences'), payload)
  console.debug(`[evidenceService] 凭证已上传至 Pool A ledger=${ledgerId} docId=${docRef.id}`)
  return { id: docRef.id, ...payload }
}

// ════════════════════════════════════════════════════════════════
// § 6d  更新凭证池备注
// ════════════════════════════════════════════════════════════════

/**
 * updateEvidencePoolNote — 在凭证池中为某张凭证写备注
 * 调用方：Pool A / Pool B 卡片内联编辑
 */
export async function updateEvidencePoolNote(
  evidenceId: string,
  poolNote:   string,
): Promise<void> {
  await updateDoc(doc(db, 'evidences', evidenceId), { poolNote })
}

// ════════════════════════════════════════════════════════════════
// § 7  订阅凭证池（Pool A: unprocessed / Pool B: orphan+replaced）
// ════════════════════════════════════════════════════════════════

/**
 * subscribePoolEvidences — 实时订阅指定账套的凭证池
 *
 * Pool A（待处理收件箱）：status === 'unprocessed'（新上传，尚未关联任何账单）
 * Pool B（解绑归档）：status === 'orphan' | 'replaced'（曾关联，已释放）
 *
 * 注意：此查询仅按 ledgerId 过滤，客户端按 status 分组。
 * 生产环境建议在 Firestore 控制台为 (ledgerId, status) 创建复合索引以提升性能。
 *
 * @param ledgerId 账套 ID
 * @param callback 每次变更触发，接收分组后的 poolA / poolB 数组
 */
export function subscribePoolEvidences(
  ledgerId: string,
  callback: (poolA: Evidence[], poolB: Evidence[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'evidences'),
    where('ledgerId', '==', ledgerId),
  )

  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Evidence)

      // Pool A：unprocessed，按上传时间倒序（最新在前）
      const poolA = all
        .filter(e => e.status === 'unprocessed')
        .sort((a, b) => b.uploadedAt - a.uploadedAt)

      // Pool B：orphan + replaced，按解绑时间倒序
      const poolB = all
        .filter(e => e.status === 'orphan' || e.status === 'replaced')
        .sort((a, b) => (b.orphanedAt ?? b.uploadedAt) - (a.orphanedAt ?? a.uploadedAt))

      callback(poolA, poolB)
    },
    (err) => {
      console.error('[evidenceService] 凭证池订阅错误:', err.message)
    },
  )
}

// ════════════════════════════════════════════════════════════════
// § 8  硬删除凭证（仅凭证池 UI 调用，物理删除 Storage + Firestore）
// ════════════════════════════════════════════════════════════════

/**
 * hardDeleteEvidence — 永久删除凭证（Storage 文件 + Firestore 文档双删）
 *
 * ⚠️  此函数只应由凭证池 UI 调用，绝不在主账单流程中使用。
 *     主账单流程解绑凭证应使用 softUnbindEvidence（保留至凭证池）。
 *
 * @param evidenceId  Firestore evidences 文档 ID
 * @param storagePath Firebase Storage 存储路径
 */
export const hardDeleteEvidence = deleteEvidence

// ════════════════════════════════════════════════════════════════
// § 9  从凭证池重新关联到账单（Pool → ok）
// ════════════════════════════════════════════════════════════════

/**
 * linkEvidenceToTransaction — 将池中凭证挂载到目标账单
 *
 * 状态机：unprocessed / orphan / replaced → ok
 *
 * 执行步骤：
 *   1. 读取凭证文档（获取 storageUrl 和当前状态）
 *   2. 将凭证状态置为 ok，绑定新 transactionId，清空孤儿标记
 *   3. 将 storageUrl 追加到 Transaction.receiptUrls（arrayUnion，幂等）
 *
 * @param evidenceId  Firestore evidences 文档 ID
 * @param txId        目标账单 Firestore 文档 ID
 * @returns           { storageUrl } 用于 AppendAmountModal 的图片预览
 */
export async function linkEvidenceToTransaction(
  evidenceId: string,
  txId:       string,
): Promise<{ storageUrl: string }> {
  // 步骤 1：读取凭证文档
  const evRef  = doc(db, 'evidences', evidenceId)
  const evSnap = await getDoc(evRef)
  if (!evSnap.exists()) throw new Error(`凭证 ${evidenceId} 不存在`)
  const evData     = evSnap.data() as { storageUrl: string }
  const storageUrl = String(evData.storageUrl ?? '')

  const now = Date.now()

  // 步骤 2：凭证文档恢复为 ok 状态
  await updateDoc(evRef, {
    status:        'ok',
    transactionId: txId,
    linkedAt:      now,    // 记录挂载时间（可选，用于审计）
    // 以下字段保留为历史，不清除（可供审计追溯来源）
  })

  // 步骤 3：追加 URL 到 Transaction.receiptUrls（幂等）
  const txRef = doc(db, 'transactions', txId)
  await updateDoc(txRef, {
    receiptUrls: arrayUnion(storageUrl),
    updatedAt:   now,
  })

  console.debug(`[evidenceService] 凭证挂载完成 evId=${evidenceId} → txId=${txId}`)
  return { storageUrl }
}
