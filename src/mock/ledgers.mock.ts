// 账套 Mock 数据
// S7 阶段接入 Firestore 后，此文件由 ledgerService.ts 查询结果替代

import type { Ledger } from '@/types/Ledger.types'

// ── 预设三个账套 ──────────────────────────────────────────────
export const MOCK_LEDGERS: Ledger[] = [
  {
    id:          'personal',
    name:        '默认个人账本',
    type:        'personal',
    ownerUid:    'mock-user-001',
    currency:    'CNY',
    timezone:    'Asia/Shanghai',
    description: '日常个人收支记录',
    createdAt:   1711900800000,
    updatedAt:   1711900800000,
    isArchived:  false,
  },
  {
    id:          'mingpao-ca',
    name:        'Ming Pao Canada',
    type:        'enterprise',
    ownerUid:    'mock-user-001',
    currency:    'CAD',
    timezone:    'America/Toronto',
    description: '明报加拿大账套',
    createdAt:   1711900800000,
    updatedAt:   1711900800000,
    isArchived:  false,
  },
  {
    id:          'ledger-elderly',
    name:        '特定长者专属',
    type:        'family',
    ownerUid:    'mock-user-001',
    currency:    'CNY',
    timezone:    'Asia/Shanghai',
    description: '特定老年人专用账套',
    createdAt:   1711900800000,
    updatedAt:   1711900800000,
    isArchived:  false,
  },
]

// 默认激活的账套 ID
export const MOCK_DEFAULT_LEDGER_ID = 'personal'
