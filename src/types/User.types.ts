// 用户档案类型定义
// Firebase Auth 提供认证，此类型存储 Auth 之外的业务字段

import type { KnownLedgerId } from './Ledger.types'

// ── 用户档案文档结构 ──────────────────────────────────────────
/**
 * UserProfile — 用户的业务档案
 * Firestore 路径：users/{userId}
 *
 * 注意：认证信息（email、密码）由 Firebase Auth 管理，
 * 此文档只存储业务侧需要的扩展字段。
 */
export interface UserProfile {
  uid:              string    // 与 Firebase Auth UID 完全一致
  displayName:      string    // 显示名称
  email:            string    // 邮箱（冗余存储，方便查询）
  avatarUrl?:       string    // 头像 URL（可选）

  // ── 账套相关 ──────────────────────────────────────────────
  /** 用户当前激活的账套 ID（切换账套时更新此字段） */
  activeLedgerId:   string
  /** 用户有权访问的账套 ID 列表（冗余字段，加速权限查询） */
  ledgerIds:        string[]

  // ── 偏好设置 ──────────────────────────────────────────────
  /** 首选货币（影响金额显示格式） */
  preferredCurrency: string   // ISO 4217，如 'CNY' / 'CAD'
  /** 首选时区 */
  preferredTimezone: string   // IANA，如 'Asia/Shanghai'
  /** 首选语言（为多语言扩展预留） */
  preferredLocale:   string   // 如 'zh-CN' / 'en-CA'

  // ── 时间戳 ────────────────────────────────────────────────
  createdAt:  number          // 注册时间戳（毫秒）
  lastSeenAt: number          // 最后活跃时间戳（毫秒）
}

// ── 新用户注册时的初始化数据 ─────────────────────────────────
/**
 * UserProfileInit — 注册时写入 Firestore 的初始值
 * S2（登录注册）完成后，在 signUp 流程中调用
 */
export function createInitialProfile(
  _uid: string,   // 调用方持有，写入 Firestore 时作为文档 ID 而非字段（故此处不使用）
  displayName: string,
  email: string,
): Omit<UserProfile, 'uid'> {
  return {
    displayName,
    email,
    activeLedgerId: 'personal' as KnownLedgerId, // 新用户默认使用个人账套
    ledgerIds:      ['personal'],                  // 默认有权访问个人账套
    preferredCurrency: 'CNY',                      // 默认货币：人民币
    preferredTimezone: 'Asia/Shanghai',            // 默认时区：北京时间
    preferredLocale:   'zh-CN',                    // 默认语言：简体中文
    createdAt:  Date.now(),                        // 写入当前时间戳
    lastSeenAt: Date.now(),
  }
}
