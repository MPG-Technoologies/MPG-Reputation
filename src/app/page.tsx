import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="inline-block bg-blue-600/20 border border-blue-500/40 px-3 py-1 rounded-full text-xs font-medium text-blue-400">
          MPG Reputation • V0.1 Implementation
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white">
          Review &amp; Reputation Automation
        </h1>

        <p className="text-slate-400 text-sm">
          Seamless, neutral customer review solicitation for local businesses. Built with zero review gating, durable workflows, and strict tenant isolation.
        </p>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/login"
            className="w-full sm:w-auto px-6 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors"
          >
            Sign In to App
          </Link>
          <Link
            href="/onboarding"
            className="w-full sm:w-auto px-6 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition-colors"
          >
            Onboard Business
          </Link>
        </div>
      </div>
    </div>
  )
}
