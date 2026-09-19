'use client'

import React from 'react'
import Link from 'next/link'

export interface TrialStatusCardProps {
  status?: string
  allocatedRequests?: number
  consumedRequests?: number
  durationDays?: number
  expiresAt?: string | null
}

export const TrialStatusCard = React.memo(function TrialStatusCard({
  status = 'NOT_STARTED',
  allocatedRequests = 30,
  consumedRequests = 0,
  durationDays = 30,
  expiresAt,
}: TrialStatusCardProps) {
  const remaining = Math.max(0, allocatedRequests - consumedRequests)
  const percentUsed =
    allocatedRequests > 0
      ? Math.min(100, Math.round((consumedRequests / allocatedRequests) * 100))
      : 0

  const getBadge = () => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Active Trial
          </span>
        )
      case 'NOT_STARTED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Not Started
          </span>
        )
      case 'EXHAUSTED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Exhausted
          </span>
        )
      case 'EXPIRED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Expired
          </span>
        )
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300">
            {status}
          </span>
        )
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Trial Entitlement
        </h3>
        {getBadge()}
      </div>

      <div>
        <div className="flex justify-between items-baseline">
          <span className="text-2xl font-bold text-white tracking-tight">{remaining}</span>
          <span className="text-xs text-slate-400">
            {status === 'NOT_STARTED'
              ? `of ${allocatedRequests} requests ready`
              : `of ${allocatedRequests} requests left`}
          </span>
        </div>

        <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${
              percentUsed >= 100
                ? 'bg-amber-500'
                : percentUsed > 80
                ? 'bg-amber-400'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
        <span>
          {status === 'NOT_STARTED'
            ? `Hypothesis: ${allocatedRequests} requests / ${durationDays} days`
            : expiresAt
            ? `Expires ${new Date(expiresAt).toLocaleDateString()}`
            : 'Validation hypothesis'}
        </span>
        <Link
          href="/app/settings/usage"
          className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
        >
          Usage &amp; Trial →
        </Link>
      </div>
    </div>
  )
})
