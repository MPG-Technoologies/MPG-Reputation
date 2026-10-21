import type { ReactNode } from 'react'

/**
 * Isolated, explicitly organization-scoped surface. It does not inherit the
 * legacy /app shell's first-membership Quick Complete or navigation context.
 * Every data page independently reads current auth and membership.
 */
export default function ScopedWorkspaceLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#090F20] text-slate-100">
    <div className="mx-auto max-w-6xl">
      <header className="px-4 sm:px-6 xl:px-8 pt-5 text-sm font-semibold tracking-wide text-blue-200">
        MPG Reputation · Business workspace
      </header>
      {children}
    </div>
  </div>
}
