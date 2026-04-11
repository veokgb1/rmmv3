// billService — 账单 Firestore 读写服务 (S5+S8)
// 封装 transactions 集合的 CRUD 操作
// useBills.correct() 纠偏完成后通过此服务将修改持久化到云端

import {
  doc, addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  collection,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { ref as storageRef, deleteObject } from 'firebase/storage'
import { db, storage } from '@/config/firebase'
import type { Transaction } from '@/types/Transaction.types'

// ─────────────────────────────────────────────────────────────
// addTransaction — 新增一条账单到 Firestore
//
// 设计：不传 id（由 Firestore addDoc 自动生成），不传 createdAt/updatedAt
// （由 serverTimestamp() 注入，保证多端时间一致）
//
// 写入后 onSnapshot 会自动推送新数据到 billStore → UI 自动重绘
// 调用方无需手动更新本地 Store
//
// @returns 新生成的 Firestore 文档 ID
// ─────────────────────────────────────────────────────────────
export async function addTransaction(
  data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'transactions'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  console.debug('[billService] 新账单已写入 Firestore:', ref.id)
  return ref.id
}

// ─────────────────────────────────────────────────────────────
// deleteTransaction — 删除单条账单（deleteDoc）
//
// 设计：写入 deleteDoc 后依赖 onSnapshot 将该条从 billStore 移除 → UI 自动消失
// 调用方绝不手动操作本地 Store，严守单向数据流红线
//
// @throws 若 Firestore 写入失败则向上抛出，由调用方处理 UI 错误态
// ─────────────────────────────────────────────────────────────
export async function deleteTransaction(id: string): Promise<void> {
  await deleteDoc(doc(db, 'transactions', id))
  console.debug('[billService] 账单已从 Firestore 删除:', id)
}

// ─────────────────────────────────────────────────────────────
// updateTransaction — 单条账单修改写入 Firestore
// ─────────────────────────────────────────────────────────────
export async function updateTransaction(
  id:    string,
  patch: Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>,
): Promise<void> {
  await updateDoc(doc(db, 'transactions', id), patch as Record<string, unknown>)
}

// ─────────────────────────────────────────────────────────────
// deleteTransactionDeep — 彻底删除一条账单（含 evidences + Storage）
//
// 执行顺序：
//   1. 查询 evidences 集合中关联该账单的所有凭证
//   2. 逐一删除 Firebase Storage 文件（容错：文件不存在则跳过）
//   3. 删除 Firestore evidences 文档
//   4. 删除 Firestore transactions 文档
//
// 适用于迁移数据的物理彻底清除，不留 Storage 垃圾
// ─────────────────────────────────────────────────────────────
export async function deleteTransactionDeep(txId: string): Promise<void> {
  // 1. 查询关联凭证
  const evSnap = await getDocs(
    query(collection(db, 'evidences'), where('transactionId', '==', txId))
  )

  // 2. 并发清理：Storage 文件 + Firestore 凭证文档
  await Promise.all(evSnap.docs.map(async evDoc => {
    const storagePath = evDoc.data()['storagePath'] as string | undefined
    if (storagePath) {
      try {
        await deleteObject(storageRef(storage, storagePath))
      } catch (e: unknown) {
        const code = (e as Record<string, unknown>)?.['code']
        if (code !== 'storage/object-not-found') {
          console.warn(`[billService] Storage 删除失败（已跳过）: ${storagePath}`, e)
        }
      }
    }
    await deleteDoc(doc(db, 'evidences', evDoc.id))
  }))

  // 3. 删除账单文档
  await deleteDoc(doc(db, 'transactions', txId))
  console.debug('[billService] 账单已深度删除（含凭证）:', txId)
}

// ─────────────────────────────────────────────────────────────
// batchDeleteTransactionsDeep — 批量深度删除账单
//
// 每批 5 条并发执行，onProgress 回调汇报已完成数量
// 返回 { deleted, errors } 供 UI 展示结果
// ─────────────────────────────────────────────────────────────
export async function batchDeleteTransactionsDeep(
  txIds:       string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0
  const errors: string[] = []
  const CONCURRENCY = 5

  for (let i = 0; i < txIds.length; i += CONCURRENCY) {
    const chunk = txIds.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map(async txId => {
      try {
        await deleteTransactionDeep(txId)
        deleted++
      } catch (e) {
        errors.push(txId)
        console.error('[billService] 深度删除失败:', txId, e)
      }
    }))
    onProgress?.(Math.min(i + CONCURRENCY, txIds.length), txIds.length)
  }

  console.info(`[billService] 批量删除完成: ${deleted}/${txIds.length} 条，失败 ${errors.length} 条`)
  return { deleted, errors }
}

// ─────────────────────────────────────────────────────────────
// batchUpdateTransactions — 批量修改（溯及既往纠偏）
// Firestore writeBatch 最多 500 条/批，超出自动分批
// ─────────────────────────────────────────────────────────────
export async function batchUpdateTransactions(
  ids:   string[],
  patch: Partial<Omit<Transaction, 'id' | 'ledgerId' | 'userId'>>,
): Promise<void> {
  const BATCH_LIMIT = 499
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT)
    const batch = writeBatch(db)
    for (const id of chunk) {
      batch.update(doc(db, 'transactions', id), patch as Record<string, unknown>)
    }
    await batch.commit()
  }
}
