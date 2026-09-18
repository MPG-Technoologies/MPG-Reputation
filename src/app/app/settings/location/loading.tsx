export default function LocationSettingsLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-page-enter">
      <div className="space-y-2">
        <div className="h-8 w-52 bg-slate-800/80 rounded animate-pulse motion-reduce:animate-none" />
        <div className="h-4 w-96 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
      </div>

      {/* Location List Skeleton */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <div className="h-5 w-36 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="divide-y divide-slate-800 p-6 space-y-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="pt-3 first:pt-0 flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-5 w-44 bg-slate-800/80 rounded animate-pulse motion-reduce:animate-none" />
                <div className="h-3 w-64 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
              </div>
              <div className="h-6 w-16 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>

      {/* Add Location Form Skeleton */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="h-5 w-40 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
        <div className="space-y-3">
          <div className="h-4 w-28 bg-slate-800/60 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-10 w-full bg-slate-800/40 rounded-md animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-20 bg-slate-800/60 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-10 w-full bg-slate-800/40 rounded-md animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="h-10 w-32 bg-slate-800/70 rounded-md animate-pulse motion-reduce:animate-none" />
      </div>
    </div>
  )
}
