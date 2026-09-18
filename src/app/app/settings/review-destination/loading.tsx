export default function ReviewDestinationLoading() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-page-enter">
      <div className="space-y-2">
        <div className="h-8 w-64 bg-slate-800/80 rounded animate-pulse motion-reduce:animate-none" />
        <div className="h-4 w-96 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
      </div>

      <div className="bg-slate-900 border border-slate-800 p-6 rounded-lg space-y-6">
        {/* Location selector skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-28 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
        </div>

        {/* Current status display skeleton */}
        <div className="bg-slate-950 border border-slate-800 p-4 rounded-md space-y-2">
          <div className="flex justify-between items-center">
            <div className="h-4 w-36 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-5 w-24 bg-slate-800/60 rounded animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="h-4 w-3/4 bg-slate-800/50 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-3 w-40 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
        </div>

        {/* Google Review Destination URL skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-36 bg-slate-800/70 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-10 w-full bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
          <div className="h-3 w-72 bg-slate-800/40 rounded animate-pulse motion-reduce:animate-none" />
        </div>

        {/* Action Buttons skeleton */}
        <div className="flex items-center gap-3 pt-2">
          <div className="h-10 w-60 bg-slate-800/80 rounded-md animate-pulse motion-reduce:animate-none" />
          <div className="h-10 w-28 bg-slate-800/50 rounded-md animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  )
}
