// userService — 用户档案 Firestore 服务 (S17)
// 职责：
//   1. ensureUserProfile — 首次 / 每次登录时在 users/{uid} 写入/更新档案
//   2. findUserByEmail   — 按邮箱查找用户（成员邀请功能使用）
//
// 数据路径：users/{uid}
// 注意：email 统一存储为小写，查询时也应小写化输入，保证一致性

import {
  doc, getDoc, setDoc,
  collection, query, where, getDocs,
} from 'firebase/firestore'
import { db } from '@/config/firebase'
import type { User } from 'firebase/auth'

// ── 存储在 Firestore 的用户档案 ───────────────────────────────
export interface StoredUser {
  uid:         string
  displayName: string
  email:       string       // 小写存储
  photoURL:    string | null
  createdAt:   number
  updatedAt:   number
}

// ─────────────────────────────────────────────────────────────
// ensureUserProfile — 登录时同步用户档案到 Firestore
//
// 策略：setDoc + merge:true
//   首次登录：完整写入所有字段（含 createdAt）
//   后续登录：仅更新可能变化的字段（displayName/photoURL/updatedAt）
//   email 不再更新（防止 Google 账号改邮后数据不一致）
//
// 调用时机：onAuthStateChanged 回调中（fire-and-forget，不阻塞 App 启动）
// ─────────────────────────────────────────────────────────────
export async function ensureUserProfile(user: User): Promise<void> {
  const ref  = doc(db, 'users', user.uid)
  const snap = await getDoc(ref)
  const now  = Date.now()

  if (!snap.exists()) {
    // 首次登录：完整写入档案
    const profile: StoredUser = {
      uid:         user.uid,
      displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Unknown',
      email:       (user.email ?? '').toLowerCase(),
      photoURL:    user.photoURL,
      createdAt:   now,
      updatedAt:   now,
    }
    await setDoc(ref, profile)
    console.debug('[userService] 新用户档案已创建:', user.uid)
  } else {
    // 后续登录：仅更新可变字段
    await setDoc(ref, {
      displayName: user.displayName ?? snap.data()['displayName'],
      photoURL:    user.photoURL    ?? snap.data()['photoURL'],
      updatedAt:   now,
    }, { merge: true })
  }
}

// ─────────────────────────────────────────────────────────────
// findUserByEmail — 按邮箱查找用户档案
//
// 用于成员邀请功能：输入邮箱 → 查找 UID → 写入账套 members 数组
//
// ⚠️  Firestore 限制：此查询需要在 users.email 字段建立索引
//     Firebase Console → Firestore → 索引 → 单字段索引 → 添加 users.email（升序）
//
// @returns StoredUser 若找到，null 若不存在
// ─────────────────────────────────────────────────────────────
export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const q    = query(collection(db, 'users'), where('email', '==', normalized))
  const snap = await getDocs(q)

  if (snap.empty) return null
  return snap.docs[0].data() as StoredUser
}
