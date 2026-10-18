'use client'

import React from 'react'
import Link from 'next/link'
import type { TrialStatus } from '@/domain/entitlement'
import { useModal } from '@/components/ui/modal-system'
import { CheckCircleIcon } from '@/components/ui/icons'

export function DestinationReadyBanner({
  trialStatus,
}: {
  trialStatus: TrialStatus | 'UNKNOWN'
}) {
  const { openQuickComplete } = useModal()
  const trialActive = trialStatus === 'ACTIVE'
  const trialNotStarted = trialStatus === 'NOT_STARTED'

  return (
    <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex items-start gap-3">
        <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-emerald-200">
            Google review link confirmed
          </div>
          <p className="text-xs text-emerald-300/80 mt-1 leading-relaxed">
            {trialActive
              ? 'Your trial is active. Next, record a genuine completed service with Quick Complete. Email permission and delivery eligibility are checked separately.'
              : trialNotStarted
                ? 'Next, start your trial in Usage & Trial. A confirmed Google link alone does not activate review-request delivery.'
                : 'Your Google link is configured, but your trial is not currently available for new review requests. Check Usage & Trial before proceeding.'}
          </p>
        </div>
      </div>

      {trialActive ? (
        <Link
          href="/app/quick-complete"
          onClick={(event) => {
            event.preventDefault()
            openQuickComplete()
          }}
          className="inline-flex shrink-0 items-center justify-center py-2 px-4 rounded-lg text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm shadow-emerald-900/30 transition-colors"
        >
          Record a Completion →
        </Link>
      ) : (
        <Link
          href="/app/settings/usage"
          className="inline-flex shrink-0 items-center justify-center py-2 px-4 rounded-lg text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm shadow-emerald-900/30 transition-colors"
        >
          View Usage &amp; Trial →
        </Link>
      )}
    </div>
  )
}
