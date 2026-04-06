// useSearchBills — 客户端账单搜索 Hook
// 接收完整账单列表，返回搜索状态和过滤后的结果
// 搜索范围：description（备注）+ category（分类）+ tags（标签）
// 设计原则：纯 UI 状态，不写入任何 Store，不触发 Firestore 查询

import { useState, useMemo } from 'react'
import type { Transaction } from '@/types/Transaction.types'

// ── Hook 返回值 ───────────────────────────────────────────────
export interface UseSearchBillsReturn {
  /** 当前搜索关键词 */
  searchQuery:   string
  /** 更新搜索词 */
  setSearchQuery: (q: string) => void
  /** 清空搜索词 */
  clearSearch:   () => void
  /** 过滤后的账单（searchQuery 为空时返回原始 bills） */
  filteredBills: Transaction[]
  /** 是否处于搜索激活状态 */
  isSearching:   boolean
  /** 命中条数（仅搜索激活时有意义） */
  matchCount:    number
}

export function useSearchBills(bills: Transaction[]): UseSearchBillsReturn {
  // 搜索关键词（UI 层状态，无需持久化）
  const [searchQuery, setSearchQuery] = useState('')

  // 是否处于搜索激活状态（非空且非纯空格）
  const isSearching = searchQuery.trim().length > 0

  // 过滤逻辑（useMemo 缓存，仅当 bills 或 query 变化时重算）
  const filteredBills = useMemo<Transaction[]>(() => {
    if (!isSearching) return bills  // 无搜索词直接返回原列表

    // 关键词统一转小写，支持模糊匹配
    const keyword = searchQuery.trim().toLowerCase()

    return bills.filter(t => {
      // 匹配 description（备注/描述）
      if (t.description?.toLowerCase().includes(keyword)) return true
      // 匹配 category（分类名，如搜"餐饮"）
      if (t.category?.toLowerCase().includes(keyword))    return true
      // 匹配 tags（标签数组）
      if (t.tags?.some(tag => tag.toLowerCase().includes(keyword))) return true
      // 匹配金额（允许搜 "100" 找到 ¥100 的账单）
      if (String(Math.abs(t.amount)).includes(keyword))  return true
      return false
    })
  }, [bills, searchQuery, isSearching])

  return {
    searchQuery,
    setSearchQuery,
    clearSearch:   () => setSearchQuery(''),
    filteredBills,
    isSearching,
    matchCount:    filteredBills.length,
  }
}
