// billService — 账单 Firestore 读写服务 (S5)
// 封装 transactions 集合的 CRUD 操作
// useBills.correct() 纠偏完成后通过此服务将修改持久化到云端

import {
  doc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/config/firebase'
import type { Transaction } from '@/types/Transaction.types'

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
