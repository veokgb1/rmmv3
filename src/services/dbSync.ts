// dbSync — 初始数据云端同步服务 (S5)
// 将本地 Mock 数据一次性写入 Firestore，供后续真实查询使用
// 生产阶段此文件由 billService / ledgerService 替代，届时可删除

import { doc, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/config/firebase'
import { MOCK_LEDGERS }       from '@/mock/ledgers.mock'
import { MOCK_TRANSACTIONS }  from '@/mock/transactions.mock'

// ── 同步结果类型 ──────────────────────────────────────────────
export interface SyncResult {
  ledgersWritten:      number
  transactionsWritten: number
  durationMs:          number
}

// ─────────────────────────────────────────────────────────────
// pushInitialData — 一键将 Mock 数据推送到 Firestore
//
// 写入策略：setDoc with merge:false（幂等覆写，重复点击安全）
// 事务策略：账套逐条 setDoc，账单批量 writeBatch（≤500条/批）
//
// Firestore 路径：
//   账套：  ledgers/{ledgerId}
//   账单：  transactions/{transactionId}
//
// 安全前提：Firestore 规则需允许写入（测试模式 or 已配置规则）
// ─────────────────────────────────────────────────────────────
export async function pushInitialData(): Promise<SyncResult> {
  const t0 = Date.now()

  // ══ 步骤 1：写入账套（3条，逐条 setDoc）══════════════════
  //   账套文档包含 members[] 多用户结构，Firestore 原生支持对象数组
  await Promise.all(
    MOCK_LEDGERS.map(ledger =>
      setDoc(doc(db, 'ledgers', ledger.id), ledger)
    )
  )
  console.info(`[dbSync] ✅ 账套写入完成 (${MOCK_LEDGERS.length} 条)`)

  // ══ 步骤 2：写入账单（批量 writeBatch，最多 500 条/批）══
  //   每批次最多处理 500 条（Firestore SDK 硬限制）
  const BATCH_SIZE = 499

  let transactionsWritten = 0
  for (let i = 0; i < MOCK_TRANSACTIONS.length; i += BATCH_SIZE) {
    const chunk = MOCK_TRANSACTIONS.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)

    for (const tx of chunk) {
      // 保留所有高级字段：status / ledgerId / members-compatible userId / tags / accountId
      // originalParsedData / rawData / ocrDoubtSpans 等均直接写入（Firestore 支持嵌套对象）
      batch.set(doc(db, 'transactions', tx.id), tx)
    }

    await batch.commit()
    transactionsWritten += chunk.length
    console.info(`[dbSync] ✅ 账单批次写入 [${i + 1}~${i + chunk.length}] (${chunk.length} 条)`)
  }

  const durationMs = Date.now() - t0
  console.info(
    `%c[dbSync] 🎉 初始数据同步完成`,
    'color: #10b981; font-weight: bold',
    `→ ${MOCK_LEDGERS.length} 个账套 + ${transactionsWritten} 条账单，耗时 ${durationMs}ms`
  )

  return {
    ledgersWritten:      MOCK_LEDGERS.length,
    transactionsWritten,
    durationMs,
  }
}
