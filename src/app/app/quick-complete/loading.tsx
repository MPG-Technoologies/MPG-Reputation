export default function QuickCompleteLoading() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-page-enter">
      <div className="space-y-2">
        <div className="h-8 w-48 bg-slate-800/80 rounded animate-pulse motion-reduce:animate-none" />
        <div className="h-4 w-96 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
      </div>

      <div className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-lg shadow-xl space-y-6">
        {/* Location selector skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-20 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
        </div>

        {/* Name fields skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-4 w-24 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-24 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
          </div>
        </div>

        {/* Contact fields skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-4 w-28 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-28 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
          </div>
        </div>

        {/* Permission options skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-10 bg-slate-800/40 rounded-md animate-pulse motion-reduce:animate-none" />
            <div className="h-10 bg-slate-800/40 rounded-md animate-pulse motion-reduce:animate-none" />
            <div className="h-10 bg-slate-800/40 rounded-md animate-pulse motion-reduce:animate-none" />
          </div>
        </div>

        {/* Action button skeleton */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <div className="h-10 w-48 bg-slate-800/70 rounded-md animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  )
}
