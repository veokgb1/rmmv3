// useQueryBills — 账单搜索 + 多维筛选 Hook (S19)
//
// 在 billStore._allTransactions（当前账套）基础上叠加筛选层
// 不开新 Firestore 监听，复用 useFirestoreSync 已建立的实时连接
//
// 使用方式：
//   const [filters, setFilters] = useState<QueryFilters>(DEFAULT_FILTERS)
//   const { bills, income, expense, billsReady } = useQueryBills(filters)

import { useMemo }      from 'react'
import { useBillStore } from '@/store/billStore'
import type { Transaction } from '@/types/Transaction.types'

// ── 筛选维度定义 ────────────────────────────────────────────────

/** 收支方向筛选 */
export type DirectionFilter = 'all' | 'income' | 'expense'

export interface QueryFilters {
  /** 描述 / 分类关键词，大小写不敏感，空字符串 = 不限 */
  keyword:   string
  /** 收支方向 */
  direction: DirectionFilter
  /** 一级分类，null = 不限 */
  category:  string | null
  /** 开始日期 YYYY-MM-DD，null = 不限 */
  dateFrom:  string | null
  /** 结束日期 YYYY-MM-DD，null = 不限 */
  dateTo:    string | null
}

/** 初始筛选条件（展示全部账单） */
export const DEFAULT_FILTERS: QueryFilters = {
  keyword:   '',
  direction: 'all',
  category:  null,
  dateFrom:  null,
  dateTo:    null,
}

// ── Hook 返回值 ─────────────────────────────────────────────────

export interface UseQueryBillsReturn {
  /** 满足所有筛选条件的账单（按日期降序） */
  bills:      Transaction[]
  totalCount: number
  /** 筛选结果中的总收入（正数） */
  income:     number
  /** 筛选结果中的总支出（正数） */
  expense:    number
  /** Firestore 首次快照是否已到达 */
  billsReady: boolean
}

// ─────────────────────────────────────────────────────────────
// useQueryBills
// ─────────────────────────────────────────────────────────────
export function useQueryBills(filters: QueryFilters): UseQueryBillsReturn {
  const allTransactions = useBillStore(s => s._allTransactions)
  const billsReady      = useBillStore(s => s.billsReady)

  // ── 筛选 ───────────────────────────────────────────────────
  // billStore._allTransactions 已经是当前账套的数据（onSnapshot 按 ledgerId 查询）
  // 此处只需叠加用户的搜索/筛选条件
  const bills = useMemo(() => {
    const { keyword, direction, category, dateFrom, dateTo } = filters
    const kw = keyword.trim().toLowerCase()

    return allTransactions
      // 过滤作废账单
      .filter(tx => tx.status !== 'void')
      // 关键词搜索（描述 + 分类）
      .filter(tx => {
        if (!kw) return true
        return (
          tx.description.toLowerCase().includes(kw) ||
          tx.category.toLowerCase().includes(kw)
        )
      })
      // 收支方向
      .filter(tx => {
        if (direction === 'income')  return tx.amount > 0
        if (direction === 'expense') return tx.amount < 0
        return true
      })
      // 一级分类
      .filter(tx => !category || tx.category === category)
      // 日期范围
      .filter(tx => !dateFrom || tx.date >= dateFrom)
      .filter(tx => !dateTo   || tx.date <= dateTo)
      // 按日期降序排列（最新在前）
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [allTransactions, filters])

  // ── 统计汇总 ───────────────────────────────────────────────
  const { income, expense } = useMemo(() => {
    let inc = 0, exp = 0
    bills.forEach(tx => {
      if (tx.amount > 0) inc += tx.amount
      else               exp -= tx.amount   // expense 存为正数
    })
    return { income: inc, expense: exp }
  }, [bills])

  return { bills, totalCount: bills.length, income, expense, billsReady }
}
