'use client'

import React from 'react'
import Link from 'next/link'
import type { SystemStatus, SetupChecklistItem } from '@/lib/dashboard/realtime-types'
import { CheckCircleIcon } from '@/components/ui/icons'

interface SystemStatusCardProps {
  status: SystemStatus
  statusDescription: string
  failedCount: number
  locationsNeedingDestinationCount?: number
  setupChecklist?: SetupChecklistItem[]
}

const STATUS_CONFIG: Record<
  SystemStatus,
  { label: string; badge: string; dot: string }
> = {
  RUNNING: {
    label: 'Running',
    badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80',
    dot: 'bg-emerald-400',
  },
  READY_FOR_SYNTHETIC_TEST: {
    label: 'Ready for Test',
    badge: 'bg-blue-950/60 text-blue-300 border-blue-800/80',
    dot: 'bg-blue-400',
  },
  SETUP_REQUIRED: {
    label: 'Setup Required',
    badge: 'bg-amber-950/60 text-amber-300 border-amber-800/80',
    dot: 'bg-amber-400',
  },
  NEEDS_ATTENTION: {
    label: 'Needs Attention',
    badge: 'bg-rose-950/60 text-rose-300 border-rose-800/80',
    dot: 'bg-rose-400',
  },
}

export const SystemStatusCard = React.memo(function SystemStatusCard({
  status,
  statusDescription,
  failedCount,
  locationsNeedingDestinationCount = 0,
  setupChecklist = [],
}: SystemStatusCardProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.RUNNING

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">System Status</h2>
          <span className="text-[11px] text-slate-500 block mt-0.5">
            V0.2 Controlled Staging
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold border ${config.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
          {config.label}
        </span>
      </div>

      {/* Content & Invariant Lines */}
      <div className="p-5 space-y-3.5 text-xs">
        {/* State Summary Description */}
        <p className="text-slate-300 leading-relaxed pb-3 border-b border-slate-800/80">
          {statusDescription}
        </p>

        {/* Invariant Lines */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-300">
              <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Neutral solicitation</span>
            </span>
            <span className="font-medium text-slate-200">Active</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-300">
              <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Review gating</span>
            </span>
            <span className="font-medium text-slate-200">Disabled (Strict)</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-300">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  failedCount > 0 ? 'bg-rose-500' : 'bg-emerald-400'
                }`}
              />
              <span>Failed dispatches</span>
            </span>
            <span
              className={`font-semibold ${
                failedCount > 0 ? 'text-rose-400' : 'text-slate-200'
              }`}
            >
              {failedCount}
            </span>
          </div>
        </div>

        {setupChecklist.length > 0 && (
          <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
              Local activation checklist
            </div>

            {setupChecklist.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                {item.complete ? (
                  <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-amber-500 shrink-0 mt-0.5" />
                )}

                <div>
                  <div className="text-slate-200 font-medium">
                    {item.label}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    {item.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Location Destination Missing CTA if applicable */}
        {locationsNeedingDestinationCount > 0 && (
          <div className="pt-2">
            <Link
              href="/app/settings/review-destination"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-medium bg-amber-950/80 hover:bg-amber-900/80 text-amber-200 border border-amber-800/80 transition-colors text-center"
            >
              Configure Review Destination →
            </Link>
          </div>
        )}

        {/* Truthful Guarantee Footer */}
        <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 leading-relaxed">
          Truthful Guarantee: MPG Reputation never fabricates reviews received, star ratings, or ROI metrics. A tracked click is recorded only as a link click.
        </div>
      </div>
    </div>
  )
})
