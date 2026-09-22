import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Internal inspection | MPG Reputation',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <p className="mb-8 text-sm font-medium tracking-wide text-slate-400">
          MPG Reputation · Internal inspection
        </p>
        {children}
      </div>
    </main>
  )
}
