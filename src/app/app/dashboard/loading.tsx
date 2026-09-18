export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-page-enter">
      {/* Header and Status Badge Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-40 bg-slate-800/80 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-64 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="h-7 w-32 bg-slate-800/70 rounded-full animate-pulse motion-reduce:animate-none" />
      </div>

      {/* Metric Cards Skeleton Grid (6 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-slate-900 border border-slate-800 p-5 rounded-lg space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-28 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
              <div className="h-4 w-4 bg-slate-800/50 rounded-full animate-pulse motion-reduce:animate-none" />
            </div>
            <div className="h-8 w-16 bg-slate-800/90 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-44 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
          </div>
        ))}
      </div>

      {/* Invariants & Automation Card Skeleton */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="h-5 w-48 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-4 w-36 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-36 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-36 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="h-3 w-80 bg-slate-800/30 rounded animate-pulse motion-reduce:animate-none" />
      </div>

      {/* Recent Activity Table Skeleton */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="space-y-1">
            <div className="h-5 w-48 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-64 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="h-4 w-20 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
        </div>

        <div className="divide-y divide-slate-800 p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pt-3 first:pt-0 flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-4 w-40 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
                <div className="h-3 w-60 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
              </div>
              <div className="h-6 w-16 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
