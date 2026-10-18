import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCheckoutReturnMessage } from '@/domain/billing/ui-state'

export async function CheckoutReturnScreen({
  kind,
}: {
  kind: 'success' | 'cancel'
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) redirect('/login')
  const message = getCheckoutReturnMessage(kind)

  // Never trust or display the query string session_id as payment evidence.
  // Provider webhook + verified subscription truth owns paid state.
  return (
    <main className="min-h-screen bg-[#070C18] text-slate-100 grid place-items-center p-5">
      <div className="max-w-lg w-full rounded-2xl border border-[#1C2846] bg-[#0E172B] p-8 shadow-xl">
        <p className="text-xs uppercase tracking-wider text-blue-300 font-semibold">MPG Reputation · TEST checkout</p>
        <h1 className="mt-4 text-2xl font-semibold text-white">{message.title}</h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">{message.description}</p>
        <Link href="/app/settings/billing"
          className="mt-6 inline-flex rounded-lg bg-blue-600 text-white text-sm font-semibold px-4 py-3 hover:bg-blue-500">
          View billing status
        </Link>
        <p className="mt-4 text-xs text-slate-500">
          Your 30 Free Review Requests trial is tracked separately in Usage &amp; Trial.
        </p>
      </div>
    </main>
  )
}
