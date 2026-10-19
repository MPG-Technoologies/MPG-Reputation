'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type BillingAction = 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL'
type PlanId = 'monthly' | 'annual'

export function LocalSyntheticBillingActions(props: {
  organizationId: string
  planId: PlanId
  hasTestAccount: boolean
  hasOngoingSubscription: boolean
}) {
  const { organizationId, planId, hasTestAccount, hasOngoingSubscription } = props
  const router = useRouter()
  const [busy, setBusy] = useState<BillingAction | null>(null)
  const [feedback, setFeedback] = useState('')

  async function perform(action: BillingAction) {
    if (busy) return
    setBusy(action)
    setFeedback('')
    try {
      const request = action === 'CHECKOUT'
        ? { action, organizationId, planId }
        : { action, organizationId }
      const response = await fetch('/api/internal/billing/test/action', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-mpg-billing-action': '1',
        },
        body: JSON.stringify(request),
      })
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('Invalid response')
      }
      const parsed = result as Record<string, unknown>
      if (response.ok && parsed.outcome === 'READY') {
        if (action === 'CUSTOMER_SETUP') {
          setFeedback('TEST billing account setup was recorded. Refreshing billing status.')
          router.refresh()
          return
        }
        if (typeof parsed.redirectUrl !== 'string') throw new Error('Missing URL')
        const url = new URL(parsed.redirectUrl)
        const destinationAllowed = url.protocol === 'https:' &&
          url.port === '' && url.username === '' && url.password === '' &&
          url.hash === '' && url.search === '' &&
          (action === 'CHECKOUT'
            ? url.hostname === 'checkout.stripe.com' &&
              url.pathname.startsWith('/c/')
            : url.hostname === 'billing.stripe.com' &&
              url.pathname.startsWith('/p/session/test_'))
        if (!destinationAllowed) throw new Error('Unsafe URL')
        window.location.assign(parsed.redirectUrl)
        return
      }
      const reason = parsed.reason
      setFeedback(
        reason === 'RATE_LIMITED'
          ? 'Too many TEST billing requests. Try again later.'
          : parsed.outcome === 'RETRY_REQUIRED'
            ? 'The previous TEST operation is still being verified. Avoid repeated attempts.'
            : parsed.outcome === 'MANUAL_REVIEW_REQUIRED'
              ? 'This TEST billing operation needs MPG support review before another attempt.'
              : 'The TEST billing operation is unavailable. No payment was confirmed.'
      )
    } catch {
      setFeedback('Unable to complete TEST operation. No payment has been confirmed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[#1C2846] pt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">
        Local synthetic billing developer controls
      </p>
      {!hasTestAccount ? (
        <button type="button" disabled={busy !== null}
          onClick={() => void perform('CUSTOMER_SETUP')}
          className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy === 'CUSTOMER_SETUP' ? 'Checking account…' : 'Set up TEST billing account'}
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null || hasOngoingSubscription}
            onClick={() => void perform('CHECKOUT')}
            className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'CHECKOUT' ? 'Preparing…' : 'Open TEST checkout'}
          </button>
          <button type="button" disabled={busy !== null}
            onClick={() => void perform('PORTAL')}
            className="flex-1 rounded-lg border border-[#2A3A62] px-4 py-2.5 text-sm font-semibold text-blue-200 disabled:opacity-50">
            {busy === 'PORTAL' ? 'Preparing…' : 'Open TEST billing portal'}
          </button>
        </div>
      )}
      {hasOngoingSubscription && (
        <p className="text-xs text-slate-400">
          An ongoing TEST subscription is recorded. Another checkout is disabled.
        </p>
      )}
      <p className="text-xs leading-relaxed text-slate-400">
        Developer-only engineering controls. No LIVE billing, real-customer payments
        or paid access are authorized. Portal and checkout require separate TEST
        provider configuration and do not prove payment settlement.
      </p>
      {feedback && <p role="status" aria-live="polite" className="text-sm text-amber-200">
        {feedback}
      </p>}
    </div>
  )
}
