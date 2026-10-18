'use client'

import { useState } from 'react'
import type { ReputationBillingPlanId } from '@/domain/billing/catalog'

interface PlanPreview {
  readonly id: ReputationBillingPlanId
  readonly amountMinor: number
  readonly interval: 'month' | 'year'
  readonly currency: 'PHP'
}

export function BillingPlanPreview({ plans }: { plans: readonly PlanPreview[] }) {
  const [selected, setSelected] = useState<ReputationBillingPlanId>('monthly')
  const current = plans.find(plan => plan.id === selected) ?? plans[0]

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Billing plan preview" className="grid sm:grid-cols-2 gap-3">
        {plans.map(plan => (
          <button
            key={plan.id}
            type="button"
            aria-pressed={selected === plan.id}
            onClick={() => setSelected(plan.id)}
            className={`text-left p-5 rounded-xl border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${selected === plan.id
              ? 'border-blue-500 bg-blue-950/30'
              : 'border-[#1C2846] bg-[#0A1020] hover:border-[#395078]'}`}
          >
            <span className="block text-xs font-semibold tracking-wider uppercase text-slate-400">
              {plan.id === 'monthly' ? 'Monthly' : 'Yearly'}
            </span>
            <span className="block mt-2 text-3xl text-white font-bold">
              {new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
                .format(plan.amountMinor / 100)}
            </span>
            <span className="block mt-1 text-xs text-slate-400">
              {plan.interval === 'year' ? 'Total for 12 months' : 'Per month'}
            </span>
          </button>
        ))}
      </div>
      <div aria-live="polite" className="p-4 rounded-xl bg-[#131E38] border border-[#1C2846]">
        <div className="font-medium text-slate-100">
          {current?.id === 'annual' ? 'Yearly preview selected' : 'Monthly preview selected'}
        </div>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          This is an engineering pricing preview, not an available offer. Checkout and
          subscription changes are disabled until MPG approves deployed TEST billing.
        </p>
        <button
          disabled
          type="button"
          className="mt-4 w-full py-2.5 rounded-lg bg-slate-800 text-slate-400 font-semibold text-sm cursor-not-allowed"
        >
          Checkout not available yet
        </button>
      </div>
    </div>
  )
}
