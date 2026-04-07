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
  query, where, onSnapshot,
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
