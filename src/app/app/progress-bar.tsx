'use client'

import { useNavigation } from './nav-context'

export function TopProgressBar() {
  const { isNavigating } = useNavigation()

  if (!isNavigating) {
    return null
  }

  return (
    <div
      role="progressbar"
      aria-label="Navigation progress"
      aria-busy="true"
      className="fixed top-0 left-0 right-0 z-50 h-[2.5px] bg-slate-900/40 overflow-hidden pointer-events-none"
    >
      <div className="h-full w-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-nav-progress" />
    </div>
  )
}
