// SearchBar — 账单搜索输入框（受控组件）
// 特性：
//   · 聚焦时展开（宽度动画）
//   · 有内容时显示一键清空按钮
//   · 支持键盘 Escape 清空并失去焦点
//   · 完全受控：value + onChange 由父组件管理

interface SearchBarProps {
  value:        string
  onChange:     (q: string) => void
  onClear:      () => void
  placeholder?: string
  className?:   string
  /** 搜索命中条数（isSearching=true 且有结果时展示） */
  matchCount?:  number
  isSearching?: boolean
}

export default function SearchBar({
  value,
  onChange,
  onClear,
  placeholder = '搜索描述、分类、金额…',
  className   = '',
  matchCount,
  isSearching = false,
}: SearchBarProps) {
  const hasValue = value.trim().length > 0

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Escape 键：清空搜索词，输入框失去焦点
    if (e.key === 'Escape') {
      onClear()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      {/* 搜索图标 */}
      <svg
        className="absolute left-3 w-4 h-4 text-content-tertiary pointer-events-none flex-shrink-0"
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>

      {/* 搜索输入框 */}
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`
          w-full pl-9 pr-${hasValue ? '8' : '4'} py-2
          bg-surface-overlay text-content-primary text-xs
          rounded-xl border border-transparent
          focus:border-border-focus focus:bg-surface-card
          outline-none transition-all placeholder:text-content-tertiary
        `}
      />

      {/* 一键清空按钮（有内容时显示） */}
      {hasValue && (
        <button
          onClick={onClear}
          title="清空搜索"
          className="absolute right-2.5 w-5 h-5 rounded-full
                     bg-content-tertiary/20 hover:bg-content-tertiary/40
                     flex items-center justify-center transition-colors"
        >
          <svg className="w-3 h-3 text-content-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* 搜索结果计数提示（右侧角标） */}
      {isSearching && matchCount !== undefined && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1
                         bg-primary-600 text-white text-[10px] font-bold
                         rounded-full flex items-center justify-center leading-none">
          {matchCount > 99 ? '99+' : matchCount}
        </span>
      )}
    </div>
  )
}
