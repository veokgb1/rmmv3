// backupService — V3 数据管理中心核心服务
//
// 职责：
//   createBackup()       — 生成备份快照，写入 Firebase Storage，更新 Firestore 元数据
//   loadAllBackupSlots() — 加载 4 种类型 × 3 槽位的元数据
//   fetchDeleteCounts()  — 预览各删除模块的记录数
//   executeDelete()      — 物理删除 Firestore 记录 + Storage 文件（分批 499 条/batch）
//
// 存储架构 (3+3+3+3 FIFO)：
//   Firestore 元数据：ledgers/{ledgerId}/backupMeta/{type}  → { slots: BackupSlot[] }
//   Storage 文件   ：backups/{ledgerId}/{type}/slot-{0|1|2}.json
//
// FIFO 覆盖规则：
//   ・槽位数 < 3 时：使用首个空闲 index (0/1/2)
//   ・槽位数 = 3 时：找出 createdAt 最小者，用其 index 覆盖并物理删除旧文件

import {
  collection, getDocs, query, where,
  doc, setDoc, getDoc, writeBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import {
  ref as storageRef,
  uploadBytes,
  deleteObject,
  getDownloadURL,
} from 'firebase/storage'
import { db, storage } from '@/config/firebase'

// ════════════════════════════════════════════════════════════════
// § 1  常量与类型
// ════════════════════════════════════════════════════════════════

export type BackupType = 'full' | 'conflict' | 'poolA' | 'poolB'

export const BACKUP_TYPE_META: Record<BackupType, {
  label: string
  icon:  string
  desc:  string
}> = {
  full:     { label: '正式库全量备份 (Transactions + Evidences)', icon: '🗄️', desc: '账套内所有 transactions + evidences' },
  conflict: { label: '冲突中心备份 (B)',   icon: '⚠️',  desc: '待验证记录及其关联凭证 (status=expected)' },
  poolA:    { label: '凭证池 A 备份 (C)',  icon: '📥', desc: '收件箱未处理照片 (status=unprocessed)' },
  poolB:    { label: '凭证池 B 备份 (D)',  icon: '🗂️', desc: '解绑/孤儿照片 (orphan + replaced)' },
}

/** 单个备份槽位元数据（存储在 Firestore） */
export interface BackupSlot {
  index:       0 | 1 | 2
  createdAt:   number    // Unix ms
  label:       string    // "YYYY-MM-DD HH:mm"（展示用）
  sizeByte:    number    // JSON 文件字节数
  storagePath: string    // Firebase Storage 路径
  counts:      { transactions: number; evidences: number }
}

/** 备份 JSON 快照（写入 Firebase Storage 的文件内容） */
export interface BackupSnapshot {
  meta: {
    backupId:  string
    type:      BackupType
    ledgerId:  string
    createdAt: number
    slotIndex: number
    counts:    { transactions: number; evidences: number }
  }
  transactions: Record<string, unknown>[]  // 原始 Firestore 文档数据 + id 字段
  evidences:    Record<string, unknown>[]  // 原始 Firestore 文档数据 + id 字段
}

// ════════════════════════════════════════════════════════════════
// § 2  删除模块定义
// ════════════════════════════════════════════════════════════════

export type DeleteModule = 'manual' | 'v2import' | 'evidenceOk' | 'poolA' | 'poolB'

export const DELETE_MODULE_META: Record<DeleteModule, {
  label:      string
  icon:       string
  hasStorage: boolean    // 是否需要同步删除 Firebase Storage 文件
}> = {
  manual:     { label: '手动入账记录',       icon: '✍️', hasStorage: false },
  v2import:   { label: 'V2 迁移记录',        icon: '📦', hasStorage: false },
  evidenceOk: { label: '已绑定凭证图片',     icon: '🖼️', hasStorage: true  },
  poolA:      { label: '凭证池 A（未处理）', icon: '📥', hasStorage: true  },
  poolB:      { label: '凭证池 B（解绑）',   icon: '🗂️', hasStorage: true  },
}

// ════════════════════════════════════════════════════════════════
// § 3  工具函数
// ════════════════════════════════════════════════════════════════

function formatSlotLabel(ms: number): string {
  const d   = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024)           return `${bytes} B`
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ════════════════════════════════════════════════════════════════
// § 4  加载备份槽位元数据
// ════════════════════════════════════════════════════════════════

export async function loadBackupSlots(
  ledgerId: string,
  type:     BackupType,
): Promise<BackupSlot[]> {
  const metaRef = doc(db, 'ledgers', ledgerId, 'backupMeta', type)
  const snap    = await getDoc(metaRef)
  if (!snap.exists()) return []
  return (snap.data() as { slots?: BackupSlot[] }).slots ?? []
}

/** 一次并发加载 4 种类型的全部槽位 */
export async function loadAllBackupSlots(
  ledgerId: string,
): Promise<Record<BackupType, BackupSlot[]>> {
  const [full, conflict, poolA, poolB] = await Promise.all([
    loadBackupSlots(ledgerId, 'full'),
    loadBackupSlots(ledgerId, 'conflict'),
    loadBackupSlots(ledgerId, 'poolA'),
    loadBackupSlots(ledgerId, 'poolB'),
  ])
  return { full, conflict, poolA, poolB }
}

// ════════════════════════════════════════════════════════════════
// § 5  抓取各备份类型数据
// ════════════════════════════════════════════════════════════════

async function fetchBackupData(
  ledgerId: string,
  type:     BackupType,
): Promise<{
  transactions: Record<string, unknown>[]
  evidences:    Record<string, unknown>[]
}> {
  const txCol = collection(db, 'transactions')
  const evCol = collection(db, 'evidences')
  const snap2obj = (d: QueryDocumentSnapshot<DocumentData>) =>
    ({ id: d.id, ...d.data() }) as Record<string, unknown>

  switch (type) {

    case 'full': {
      const [txSnap, evSnap] = await Promise.all([
        getDocs(query(txCol, where('ledgerId', '==', ledgerId))),
        getDocs(query(evCol, where('ledgerId', '==', ledgerId))),
      ])
      return {
        transactions: txSnap.docs.map(snap2obj),
        evidences:    evSnap.docs.map(snap2obj),
      }
    }

    case 'conflict': {
      const txSnap = await getDocs(query(
        txCol,
        where('ledgerId', '==', ledgerId),
        where('status',   '==', 'expected'),
      ))
      // 关联凭证按 transactionId 批量拉取（Firestore 'in' 上限 30 条/次）
      const txIds = txSnap.docs.map(d => d.id)
      const evidences: Record<string, unknown>[] = []
      for (let i = 0; i < txIds.length; i += 30) {
        const chunk = txIds.slice(i, i + 30)
        if (chunk.length === 0) break
        const evSnap = await getDocs(query(evCol, where('transactionId', 'in', chunk)))
        evSnap.docs.forEach(d => evidences.push(snap2obj(d)))
      }
      return { transactions: txSnap.docs.map(snap2obj), evidences }
    }

    case 'poolA': {
      const evSnap = await getDocs(query(
        evCol,
        where('ledgerId', '==', ledgerId),
        where('status',   '==', 'unprocessed'),
      ))
      return { transactions: [], evidences: evSnap.docs.map(snap2obj) }
    }

    case 'poolB': {
      // 分两次查询（orphan + replaced），避免需要 'in' 复合索引
      const [s1, s2] = await Promise.all([
        getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status', '==', 'orphan'))),
        getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status', '==', 'replaced'))),
      ])
      return {
        transactions: [],
        evidences: [...s1.docs, ...s2.docs].map(snap2obj),
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// § 6  创建备份（FIFO 覆盖）
// ════════════════════════════════════════════════════════════════

export async function createBackup(
  ledgerId:    string,
  type:        BackupType,
  onProgress?: (msg: string) => void,
): Promise<BackupSlot> {

  onProgress?.('读取账套数据中…')
  const { transactions, evidences } = await fetchBackupData(ledgerId, type)

  onProgress?.('检查备份槽位…')
  const existingSlots = await loadBackupSlots(ledgerId, type)

  // ── FIFO 选槽 ──────────────────────────────────────────────
  let slotIndex:     0 | 1 | 2
  let oldStoragePath: string | null = null

  if (existingSlots.length < 3) {
    const usedSet = new Set(existingSlots.map(s => s.index))
    slotIndex = ([0, 1, 2] as const).find(i => !usedSet.has(i))!
  } else {
    // 找出最老的槽位
    const oldest   = existingSlots.reduce((a, b) => (a.createdAt < b.createdAt ? a : b))
    slotIndex      = oldest.index
    oldStoragePath = oldest.storagePath
  }

  // ── 物理抹除旧文件（零遗迹原则）──────────────────────────
  if (oldStoragePath) {
    onProgress?.('抹除旧备份文件…')
    try { await deleteObject(storageRef(storage, oldStoragePath)) }
    catch { /* 文件已不存在，忽略错误继续 */ }
  }

  // ── 构建快照 JSON ─────────────────────────────────────────
  const now = Date.now()
  const snapshot: BackupSnapshot = {
    meta: {
      backupId:  `${type}-${ledgerId.slice(-6)}-${now}`,
      type,
      ledgerId,
      createdAt: now,
      slotIndex,
      counts: { transactions: transactions.length, evidences: evidences.length },
    },
    transactions,
    evidences,
  }

  // ── 上传至 Firebase Storage ───────────────────────────────
  onProgress?.('上传备份文件至 Storage…')
  const storagePath = `backups/${ledgerId}/${type}/slot-${slotIndex}.json`
  const jsonStr     = JSON.stringify(snapshot)
  const blob        = new Blob([jsonStr], { type: 'application/json' })
  await uploadBytes(storageRef(storage, storagePath), blob)

  // ── 写入 Firestore 元数据 ─────────────────────────────────
  onProgress?.('写入备份元数据…')
  const newSlot: BackupSlot = {
    index:       slotIndex,
    createdAt:   now,
    label:       formatSlotLabel(now),
    sizeByte:    new TextEncoder().encode(jsonStr).length,
    storagePath,
    counts:      { transactions: transactions.length, evidences: evidences.length },
  }

  // 用新槽位替换同 index 的旧槽位，按时间降序排列（最新在前）
  const updatedSlots = [
    ...existingSlots.filter(s => s.index !== slotIndex),
    newSlot,
  ].sort((a, b) => b.createdAt - a.createdAt)

  const metaRef = doc(db, 'ledgers', ledgerId, 'backupMeta', type)
  await setDoc(metaRef, { slots: updatedSlots })

  return newSlot
}

// ════════════════════════════════════════════════════════════════
// § 7  获取各删除模块记录数（预览）
// ════════════════════════════════════════════════════════════════

export async function fetchDeleteCounts(
  ledgerId: string,
): Promise<Record<DeleteModule, number>> {
  const txCol = collection(db, 'transactions')
  const evCol = collection(db, 'evidences')

  const [manualSnap, v2Snap, evOkSnap, evASnap, evBOrphanSnap, evBReplacedSnap] =
    await Promise.all([
      getDocs(query(txCol, where('ledgerId', '==', ledgerId), where('sourceType', '==', 'manual'))),
      getDocs(query(txCol, where('ledgerId', '==', ledgerId), where('sourceType', '==', 'V2_to_V3'))),
      getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status',     '==', 'ok'))),
      getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status',     '==', 'unprocessed'))),
      getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status',     '==', 'orphan'))),
      getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status',     '==', 'replaced'))),
    ])

  return {
    manual:     manualSnap.size,
    v2import:   v2Snap.size,
    evidenceOk: evOkSnap.size,
    poolA:      evASnap.size,
    poolB:      evBOrphanSnap.size + evBReplacedSnap.size,
  }
}

// ════════════════════════════════════════════════════════════════
// § 8  执行物理删除
// ════════════════════════════════════════════════════════════════

export async function executeDelete(
  ledgerId:    string,
  modules:     DeleteModule[],
  onProgress?: (msg: string) => void,
): Promise<number> {

  if (modules.length === 0) return 0

  const txCol = collection(db, 'transactions')
  const evCol = collection(db, 'evidences')

  // ── 收集所有待删除文档 ─────────────────────────────────────
  onProgress?.('读取待删除记录数量…')

  const allDocs:  QueryDocumentSnapshot<DocumentData>[] = []
  const storagePaths: string[] = []

  for (const mod of modules) {
    let snaps: QueryDocumentSnapshot<DocumentData>[] = []

    switch (mod) {
      case 'manual':
        snaps = (await getDocs(query(txCol, where('ledgerId', '==', ledgerId), where('sourceType', '==', 'manual')))).docs
        break
      case 'v2import':
        snaps = (await getDocs(query(txCol, where('ledgerId', '==', ledgerId), where('sourceType', '==', 'V2_to_V3')))).docs
        break
      case 'evidenceOk':
        snaps = (await getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status', '==', 'ok')))).docs
        break
      case 'poolA':
        snaps = (await getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status', '==', 'unprocessed')))).docs
        break
      case 'poolB': {
        const [s1, s2] = await Promise.all([
          getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status', '==', 'orphan'))),
          getDocs(query(evCol, where('ledgerId', '==', ledgerId), where('status', '==', 'replaced'))),
        ])
        snaps = [...s1.docs, ...s2.docs]
        break
      }
    }

    // 收集需要同步删除 Storage 文件的凭证路径
    if (DELETE_MODULE_META[mod].hasStorage) {
      snaps.forEach(d => {
        const sp = d.data()['storagePath'] as string | undefined
        if (sp) storagePaths.push(sp)
      })
    }

    allDocs.push(...snaps)
  }

  const total = allDocs.length
  if (total === 0) return 0

  // ── 物理抹除 Firebase Storage 图片文件 ────────────────────
  if (storagePaths.length > 0) {
    onProgress?.(`物理抹除 ${storagePaths.length} 个图片文件…`)
    // Promise.allSettled：部分文件已删除或不存在时继续执行，不中断流程
    await Promise.allSettled(
      storagePaths.map(sp => deleteObject(storageRef(storage, sp)))
    )
  }

  // ── Firestore 分批删除（上限 499 条/batch）─────────────────
  const BATCH_SIZE = 499
  let   deleted    = 0

  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const chunk = allDocs.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    chunk.forEach(d => batch.delete(d.ref))
    await batch.commit()
    deleted += chunk.length
    onProgress?.(`删除 Firestore 记录 ${deleted} / ${total}…`)
  }

  return total
}

// ════════════════════════════════════════════════════════════════
// § 9  手动删除单个备份槽位
// ════════════════════════════════════════════════════════════════
//
// 流程：
//   1. 从 Firestore 元数据找到目标槽位
//   2. 物理删除 Firebase Storage JSON 文件（404 静默忽略）
//   3. 从元数据数组中移除该槽位，写回 Firestore
//
// ⚠️ 404 容错：若文件已不存在，不向控制台打印红色错误，只打 warn 级日志，
//    随后照常执行 Firestore 元数据清理，保证 UI 恢复为"空槽"状态。

export async function deleteBackupSlot(
  ledgerId:  string,
  type:      BackupType,
  slotIndex: 0 | 1 | 2,
): Promise<void> {

  // 1. 读取当前元数据，找到目标槽位
  const existingSlots = await loadBackupSlots(ledgerId, type)
  const target        = existingSlots.find(s => s.index === slotIndex)

  if (!target) return   // 槽位已是空的，幂等返回

  // 2. 删除 Storage 文件（404 / 任何 Storage 错误 → 静默处理，不打红色错误）
  try {
    await deleteObject(storageRef(storage, target.storagePath))
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    // storage/object-not-found = 404，文件已不存在，正常情况
    if (code !== 'storage/object-not-found') {
      // 其他 Storage 错误只打 warn，不抛出，依然继续清理元数据
      console.warn('[backupService] deleteBackupSlot: Storage 删除非预期错误', code, err)
    }
    // 无论何种 Storage 错误，均继续执行 Firestore 元数据清理
  }

  // 3. 从元数据中移除该槽位，写回 Firestore
  const updatedSlots = existingSlots.filter(s => s.index !== slotIndex)
  const metaRef      = doc(db, 'ledgers', ledgerId, 'backupMeta', type)
  await setDoc(metaRef, { slots: updatedSlots })
}

// ════════════════════════════════════════════════════════════════
// § 10  从备份槽位恢复/转入数据
// ════════════════════════════════════════════════════════════════
//
// 流程：
//   1. 读取 Firestore 槽位元数据，定位 storagePath
//   2. getDownloadURL → fetch → JSON.parse（获得 BackupSnapshot）
//   3. 若 targetLedgerId ≠ 原 ledgerId，批量重写每条记录的 ledgerId 字段
//   4. writeBatch setDoc（防重逻辑：同 ID 覆盖，不存在新增）
//
// @param ledgerId        备份来源账套 ID（读取元数据用）
// @param type            备份类型
// @param slotIndex       要恢复的槽位 index
// @param targetLedgerId  目标账套 ID（可与 ledgerId 不同）
// @param onProgress      进度回调

export async function restoreFromBackup(
  ledgerId:       string,
  type:           BackupType,
  slotIndex:      0 | 1 | 2,
  targetLedgerId: string,
  onProgress?:    (msg: string) => void,
): Promise<{ transactions: number; evidences: number }> {

  // 1. 读取目标槽位元数据
  onProgress?.('读取备份元数据…')
  const slots = await loadBackupSlots(ledgerId, type)
  const slot  = slots.find(s => s.index === slotIndex)
  if (!slot) throw new Error('备份槽位不存在，请刷新后重试')

  // 2. 下载备份 JSON（Firebase Storage → fetch）
  onProgress?.(`下载备份文件（${formatSize(slot.sizeByte)}）…`)
  const downloadUrl = await getDownloadURL(storageRef(storage, slot.storagePath))
  const response    = await fetch(downloadUrl)
  if (!response.ok) throw new Error(`下载备份失败：HTTP ${response.status}`)
  const snapshot    = await response.json() as BackupSnapshot

  // 3. 按需重写 ledgerId（转入不同账套时）
  const needRemap = targetLedgerId !== ledgerId

  /** 从原始 Record 中剥离 id 字段，可选重写 ledgerId */
  function prepareDoc(raw: Record<string, unknown>): { id: string; data: Record<string, unknown> } {
    const id                            = raw['id'] as string | undefined ?? ''
    const { id: _dropped, ...rest }     = raw    // strip id from data fields
    const data: Record<string, unknown> = needRemap ? { ...rest, ledgerId: targetLedgerId } : rest
    return { id, data }
  }

  const txDocs = snapshot.transactions.map(prepareDoc).filter(d => d.id.length > 0)
  const evDocs = snapshot.evidences.map(prepareDoc).filter(d => d.id.length > 0)

  // 4. 批量 upsert（setDoc = 存在则完整覆盖，不存在则新增）
  const BATCH_SIZE = 499
  let written = 0

  if (txDocs.length > 0) {
    onProgress?.(`恢复 ${txDocs.length} 条 transactions…`)
    for (let i = 0; i < txDocs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db)
      const chunk = txDocs.slice(i, i + BATCH_SIZE)
      for (const { id, data } of chunk) {
        batch.set(doc(db, 'transactions', id), data)
      }
      await batch.commit()
      written += chunk.length
      onProgress?.(`写入 transactions ${written} / ${txDocs.length}…`)
    }
  }

  written = 0
  if (evDocs.length > 0) {
    onProgress?.(`恢复 ${evDocs.length} 条 evidences…`)
    for (let i = 0; i < evDocs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db)
      const chunk = evDocs.slice(i, i + BATCH_SIZE)
      for (const { id, data } of chunk) {
        batch.set(doc(db, 'evidences', id), data)
      }
      await batch.commit()
      written += chunk.length
      onProgress?.(`写入 evidences ${written} / ${evDocs.length}…`)
    }
  }

  console.info(`[backupService] 恢复完成：${txDocs.length} tx + ${evDocs.length} ev → ${targetLedgerId}`)
  return { transactions: txDocs.length, evidences: evDocs.length }
}
