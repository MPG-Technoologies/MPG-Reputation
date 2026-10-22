import Link from 'next/link'

/**
 * Customer-visible subscription discovery only.
 * Never an offer, quote, grant, checkout session, or provider action.
 * Premium has no approved catalog entry or charge amount.
 */
export function SubscriptionOptions({ location }: { location: 'usage' | 'billing' }) {
  const options = [
    {
      id: 'monthly',
      name: 'Monthly',
      cadence: 'Monthly subscription',
      description: 'Explore a recurring monthly plan for continued review-request usage.',
    },
    {
      id: 'yearly',
      name: 'Yearly',
      cadence: 'Annual subscription',
      description: 'Explore a recurring yearly plan for continued review-request usage.',
    },
    {
      id: 'premium',
      name: 'Premium',
      cadence: 'Plan details pending',
      description: 'A potential higher-capacity option. Limits, benefits and pricing are not yet approved.',
    },
  ] as const

  return (
    <section id={location === 'billing' ? 'subscription-options' : undefined}
      aria-label="Subscription options"
      className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {options.map(option => (
          <article key={option.id} data-subscription-option={option.id}
            className="flex flex-col justify-between gap-5 rounded-xl border border-[#243454] bg-[#0E172B] p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                {option.cadence}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">{option.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {option.description}
              </p>
              <p className="mt-4 text-xs text-slate-400">
                Price and included usage: not published
              </p>
            </div>
            {location === 'usage' ? (
              <Link href={`/app/settings/billing#subscription-options`}
                className="inline-flex justify-center rounded-lg border border-blue-700 px-4 py-2.5 text-sm font-semibold text-blue-200 hover:bg-blue-950/40">
                View billing options
              </Link>
            ) : (
              <button type="button" disabled
                aria-label={`${option.name} checkout not available yet`}
                className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-400 cursor-not-allowed">
                Checkout not available
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        These options are informational only. No pricing, subscription, payment, or extra review
        requests are activated by viewing them.
      </p>
    </section>
  )
}
