// ledgerService — 账套 Firestore CRUD 服务 (S17)
// 职责：
//   createLedger   — 创建新账套，创建者自动成为 owner
//   inviteMember   — 按邮箱查找用户后加入 members 数组
//   removeMember   — 从 members 数组移除指定成员
//   updateLedger   — 修改账套基础信息
//
// 权限铁律（服务层不做鉴权，由调用方 + Firestore Security Rules 保证）：
//   只有 owner 可以邀请 / 移除成员

import {
  doc, addDoc, updateDoc,
  collection, serverTimestamp,
} from 'firebase/firestore'
import { db }              from '@/config/firebase'
import { findUserByEmail } from '@/services/firebase/userService'
import type { Ledger, LedgerType, LedgerMember } from '@/types/Ledger.types'

// ── 创建账套入参 ──────────────────────────────────────────────
export interface CreateLedgerInput {
  name:         string
  type:         LedgerType
  currency:     string
  timezone:     string
  description?: string
}

// ─────────────────────────────────────────────────────────────
// createLedger — 创建新账套
//
// Firestore 文档 ID 由 addDoc 自动生成（UUID 格式）
// 创建者自动写入 members 数组，role='owner'
// onSnapshot 会将新文档推送到 ledgerStore → UI 自动出现
//
// @param ownerUid — 创建者的 Firebase Auth UID
// @returns 新账套的 Firestore 文档 ID
// ─────────────────────────────────────────────────────────────
export async function createLedger(
  ownerUid: string,
  input:    CreateLedgerInput,
): Promise<string> {
  const ownerMember: LedgerMember = {
    userId:   ownerUid,
    role:     'owner',
    joinedAt: Date.now(),
  }

  const ref = await addDoc(collection(db, 'ledgers'), {
    name:        input.name.trim(),
    type:        input.type,
    currency:    input.currency,
    timezone:    input.timezone,
    description: input.description?.trim() ?? '',
    members:     [ownerMember],
    isArchived:  false,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  })

  console.debug('[ledgerService] 新账套已创建:', ref.id)
  return ref.id
}

// ─────────────────────────────────────────────────────────────
// inviteMemberByEmail — 按邮箱邀请成员加入账套
//
// 流程：
//   1. 按邮箱在 users 集合查找目标用户
//   2. 检查是否已是成员（防止重复邀请）
//   3. 将新 LedgerMember 追加到 members 数组（覆写整个数组，避免 arrayUnion 对象相等性问题）
//
// @param ledgerId      — 目标账套 ID
// @param email         — 被邀请者邮箱
// @param currentMembers — 当前账套的 members 数组（来自 ledgerStore，已是最新快照）
// @throws 若用户不存在或已是成员
// ─────────────────────────────────────────────────────────────
export async function inviteMemberByEmail(
  ledgerId:       string,
  email:          string,
  currentMembers: LedgerMember[],
): Promise<{ displayName: string }> {
  const found = await findUserByEmail(email)

  if (!found) {
    throw new Error(`未找到使用邮箱「${email}」的用户，请确认对方已注册并登录过 RMM V3`)
  }

  // 防止重复邀请
  const alreadyMember = currentMembers.some(m => m.userId === found.uid)
  if (alreadyMember) {
    throw new Error(`「${found.displayName}」已经是该账套的成员了`)
  }

  const newMember: LedgerMember = {
    userId:   found.uid,
    role:     'editor',        // 新邀请成员默认 editor（参与者）
    joinedAt: Date.now(),
    nickname: found.displayName,
  }

  await updateDoc(doc(db, 'ledgers', ledgerId), {
    members:   [...currentMembers, newMember],  // 覆写整个数组，避免 arrayUnion 对象比较问题
    updatedAt: serverTimestamp(),
  })

  console.debug('[ledgerService] 成员已邀请:', found.uid, '→', ledgerId)
  return { displayName: found.displayName }
}

// ─────────────────────────────────────────────────────────────
// removeMember — 从账套移除指定成员
//
// 覆写整个 members 数组（过滤掉目标 UID），比 arrayRemove 更可靠
// 调用方须确认自己是 owner 且目标非 owner
//
// @param ledgerId       — 目标账套 ID
// @param targetUid      — 要移除的成员 UID
// @param currentMembers — 当前 members 数组（来自 ledgerStore）
// ─────────────────────────────────────────────────────────────
export async function removeMember(
  ledgerId:       string,
  targetUid:      string,
  currentMembers: LedgerMember[],
): Promise<void> {
  const filtered = currentMembers.filter(m => m.userId !== targetUid)

  if (filtered.length === currentMembers.length) {
    throw new Error('未找到该成员')
  }

  await updateDoc(doc(db, 'ledgers', ledgerId), {
    members:   filtered,
    updatedAt: serverTimestamp(),
  })

  console.debug('[ledgerService] 成员已移除:', targetUid, '←', ledgerId)
}

// ─────────────────────────────────────────────────────────────
// updateLedger — 修改账套基础信息
//
// 仅允许修改展示性字段（name / description / currency），
// 不暴露 members 修改入口（members 专用 inviteMember/removeMember）
// ─────────────────────────────────────────────────────────────
export async function updateLedger(
  ledgerId: string,
  patch:    Partial<Pick<Ledger, 'name' | 'description' | 'currency' | 'isArchived'>>,
): Promise<void> {
  await updateDoc(doc(db, 'ledgers', ledgerId), {
    ...patch,
    updatedAt: serverTimestamp(),
  })
}
