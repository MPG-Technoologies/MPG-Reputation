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
  if (!user || error || user.is_anonymous) redirect('/login')
  const message = getCheckoutReturnMessage(kind)

  // Never trust or display the query string session_id as payment evidence.
  // A client-selected organization is not tenant authority. The authenticated
  // business chooser lists only current memberships; each scoped billing page
  // independently revalidates access. A TEST provider return cannot establish
  // settled funds, a successful charge or paid access.
  return (
    <main className="min-h-screen bg-[#070C18] text-slate-100 grid place-items-center p-5">
      <div className="max-w-lg w-full rounded-2xl border border-[#1C2846] bg-[#0E172B] p-8 shadow-xl">
        <p className="text-xs uppercase tracking-wider text-blue-300 font-semibold">MPG Reputation · TEST checkout</p>
        <h1 className="mt-4 text-2xl font-semibold text-white">{message.title}</h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">{message.description}</p>
        <Link href="/workspace/organizations"
          className="mt-6 inline-flex rounded-lg bg-blue-600 text-white text-sm font-semibold px-4 py-3 hover:bg-blue-500">
          Choose business to view billing
        </Link>
        <p className="mt-4 text-xs text-slate-500">
          Choose the business whose billing you want to review. A checkout return
          never confirms a payment or upgrades your subscription.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Your 30 Free Review Requests trial is tracked separately in Usage &amp; Trial.
        </p>
      </div>
    </main>
  )
}
