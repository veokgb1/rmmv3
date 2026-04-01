// 账套 Mock 数据 — S8 RBAC 升级版
// 成员集合制：每个账套包含 members 数组，模拟真实多人协作场景
// S8 阶段接入 Firestore 后，此文件由 ledgerService.fetchUserLedgers() 替代

import type { Ledger } from '@/types/Ledger.types'

// Mock 用户 ID 常量（S5 接入 Firebase Auth 后替换为真实 UID）
const MOCK_UID_MAIN    = 'mock-user-001'   // 主用户（当前登录者）
const MOCK_UID_SPOUSE  = 'mock-user-002'   // 配偶（家庭账套协作演示）
const MOCK_UID_FINANCE = 'mock-user-003'   // 财务人员（企业账套演示）

const BASE_TS = 1711900800000  // 2024-04-01 00:00:00 UTC

// ── 预设三个账套（成员集合制）────────────────────────────────
export const MOCK_LEDGERS: Ledger[] = [
  {
    id:          'personal',
    name:        '默认个人账本',
    type:        'personal',
    currency:    'CNY',
    timezone:    'Asia/Shanghai',
    description: '日常个人收支记录',
    // 个人账本：仅主用户一人，角色 owner
    members: [
      { userId: MOCK_UID_MAIN, role: 'owner', joinedAt: BASE_TS },
    ],
    createdAt:  BASE_TS,
    updatedAt:  BASE_TS,
    isArchived: false,
  },
  {
    id:          'mingpao-ca',
    name:        'Ming Pao Canada',
    type:        'enterprise',
    currency:    'CAD',
    timezone:    'America/Toronto',
    description: '明报加拿大账套',
    // 企业账套：主用户为 owner，财务人员为 editor
    members: [
      { userId: MOCK_UID_MAIN,    role: 'owner',  joinedAt: BASE_TS },
      { userId: MOCK_UID_FINANCE, role: 'editor', joinedAt: BASE_TS,
        nickname: '财务专员', invitedBy: MOCK_UID_MAIN },
    ],
    createdAt:  BASE_TS,
    updatedAt:  BASE_TS,
    isArchived: false,
  },
  {
    id:          'ledger-elderly',
    name:        '特定长者专属',
    type:        'family',
    currency:    'CNY',
    timezone:    'Asia/Shanghai',
    description: '特定老年人专用账套',
    // 家庭账套：主用户为 owner，配偶为 admin（可管理成员）
    members: [
      { userId: MOCK_UID_MAIN,   role: 'owner', joinedAt: BASE_TS },
      { userId: MOCK_UID_SPOUSE, role: 'admin', joinedAt: BASE_TS,
        nickname: '家庭协管', invitedBy: MOCK_UID_MAIN },
    ],
    createdAt:  BASE_TS,
    updatedAt:  BASE_TS,
    isArchived: false,
  },
]

// 默认激活的账套 ID
export const MOCK_DEFAULT_LEDGER_ID = 'personal'
