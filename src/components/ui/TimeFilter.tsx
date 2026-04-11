/**
 * TimeFilter — shared time-range filter component
 *
 * Used by: QueryPage, ReportPage
 *
 * Modes:
 *   this    — current month  (dateFrom = YYYY-MM-01, dateTo = YYYY-MM-last)
 *   last    — previous month
 *   all     — no date constraint (dateFrom = null, dateTo = null)
 *   month   — specific past month chosen from picker
 */

import { useState } from 'react'

export type TimeFilterMode = 'this' | 'last' | 'all' | 'month'

export interface TimeFilterValue {
  mode:     TimeFilterMode
  monthKey: string | null   // YYYY-MM; null when mode === 'all'
  dateFrom: string | null   // YYYY-MM-DD
  dateTo:   string | null   // YYYY-MM-DD
  label:    string
}

interface TimeFilterProps {
  value:    TimeFilterValue
  onChange: (v: TimeFilterValue) => void
}

function buildMonthRange(yyyyMM: string): { dateFrom: string; dateTo: string } {
  const year  = parseInt(yyyyMM.slice(0, 4))
  const month = parseInt(yyyyMM.slice(5, 7))
  const last  = new Date(year, month, 0).getDate()
  return {
    dateFrom: `${yyyyMM}-01`,
    dateTo:   `${yyyyMM}-${String(last).padStart(2, '0')}`,
  }
}

function currentYYYYMM(offset = 0): string {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function makeTimeFilterValue(mode: TimeFilterMode, monthKey?: string): TimeFilterValue {
  if (mode === 'all') {
    return { mode: 'all', monthKey: null, dateFrom: null, dateTo: null, label: '全部时间' }
  }
  const key =
    mode === 'this'  ? currentYYYYMM(0)  :
    mode === 'last'  ? currentYYYYMM(-1) :
    (monthKey ?? currentYYYYMM(0))
  const { dateFrom, dateTo } = buildMonthRange(key)
  const [y, m] = key.split('-')
  const thisKey = currentYYYYMM(0)
  const label =
    mode === 'this'        ? `本月 (${parseInt(m)}月)`    :
    mode === 'last'        ? `上月 (${parseInt(m)}月)`    :
    key === thisKey        ? `${parseInt(m)}月 · 本月`    :
    `${y}年${parseInt(m)}月`
  return { mode, monthKey: key, dateFrom, dateTo, label }
}

export const DEFAULT_TIME_FILTER: TimeFilterValue =
  makeTimeFilterValue('all')

export function TimeFilter({ value, onChange }: TimeFilterProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleQuick(mode: 'this' | 'last' | 'all') {
    setPickerOpen(false)
    onChange(makeTimeFilterValue(mode))
  }

  function handleMonth(key: string) {
    setPickerOpen(false)
    onChange(makeTimeFilterValue('month', key))
  }

  const btnBase = 'flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap'
  const btnActive = 'bg-primary-600 text-white shadow-sm'
  const btnIdle   = 'bg-surface-overlay text-content-secondary hover:bg-border'

  const quickActive = (mode: 'this' | 'last' | 'all') => value.mode === mode

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        <button
          onClick={() => handleQuick('this')}
          className={`${btnBase} ${quickActive('this') ? btnActive : btnIdle}`}
        >
          本月
        </button>
        <button
          onClick={() => handleQuick('last')}
          className={`${btnBase} ${quickActive('last') ? btnActive : btnIdle}`}
        >
          上月
        </button>
        <button
          onClick={() => handleQuick('all')}
          className={`${btnBase} ${quickActive('all') ? btnActive : btnIdle}`}
        >
          全部
        </button>

        <div className="w-px h-3 bg-border flex-shrink-0 mx-0.5" />

        <button
          onClick={() => setPickerOpen(v => !v)}
          className={`${btnBase} ${
            value.mode === 'month' ? btnActive : btnIdle
          } flex items-center gap-1`}
        >
          {value.mode === 'month'
            ? value.label
            : '选月份'}
          <span className="text-[10px] opacity-70">{pickerOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      {pickerOpen && (
        <div className="flex items-center gap-2 pt-0.5">
          <input
            type="month"
            value={value.mode === 'month' ? (value.monthKey ?? '') : ''}
            onChange={e => { if (e.target.value) handleMonth(e.target.value) }}
            className="flex-1 px-3 py-1.5 text-xs bg-surface-overlay border border-border
                       rounded-xl focus:outline-none focus:border-primary-400 transition-colors"
          />
          <button
            onClick={() => setPickerOpen(false)}
            className="flex-shrink-0 text-[11px] text-content-tertiary px-2 py-1.5 rounded-lg
                       hover:bg-surface-overlay transition-colors"
          >
            ✕ 收起
          </button>
        </div>
      )}
    </div>
  )
}
