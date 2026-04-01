// Skeleton — 骨架屏占位组件
// 在 Firestore 数据首次到达前显示脉冲动画占位块
// 纯 UI，无业务逻辑

interface SkeletonProps {
  /** 高度（Tailwind h-* 类，默认 h-4） */
  h?:    string
  /** 宽度（Tailwind w-* 类，默认 w-full） */
  w?:    string
  /** 额外 className */
  className?: string
}

export function Skeleton({ h = 'h-4', w = 'w-full', className = '' }: SkeletonProps) {
  return (
    <div
      className={`${h} ${w} bg-gray-100 rounded-lg animate-pulse ${className}`}
    />
  )
}

// ── 预设骨架布局 ──────────────────────────────────────────────

/** 三 KPI 卡片骨架 */
export function StatCardsSkeleton() {
  return (
    <div className="flex gap-2.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="card flex-1 py-3.5 px-4 space-y-2">
          <Skeleton h="h-3" w="w-16" />
          <Skeleton h="h-5" w="w-20" />
        </div>
      ))}
    </div>
  )
}

/** 图表区骨架 */
export function ChartSkeleton({ height = 'h-44' }: { height?: string }) {
  return (
    <div className="card space-y-3">
      <div className="flex justify-between">
        <Skeleton h="h-4" w="w-24" />
        <Skeleton h="h-4" w="w-16" />
      </div>
      <Skeleton h={height} />
    </div>
  )
}

/** 账单列表骨架（N 行） */
export function BillListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card space-y-3">
      <Skeleton h="h-4" w="w-20" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <Skeleton h="h-10" w="w-10" className="rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton h="h-3" w="w-32" />
            <Skeleton h="h-2.5" w="w-20" />
          </div>
          <Skeleton h="h-4" w="w-14" />
        </div>
      ))}
    </div>
  )
}
