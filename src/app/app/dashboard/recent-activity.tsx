'use client'

import React from 'react'
import Link from 'next/link'
import type { ActivityRequestItem } from '@/lib/dashboard/realtime-types'

interface RecentActivityProps {
  requests: ActivityRequestItem[]
  orgName: string
  highlightedRowId: string | null
}

export const RecentActivity = React.memo(function RecentActivity({
  requests,
  orgName,
  highlightedRowId,
}: RecentActivityProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Recent Review Solicitations</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Inspect sent requests, view development email previews, and test tracked redirects.
          </p>
        </div>
        <span className="text-xs text-slate-500">Last 10 events</span>
      </div>

      {!requests || requests.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          No review solicitation activity recorded yet.
          <div className="mt-2">
            <Link href="/app/quick-complete" className="text-blue-400 hover:underline">
              Submit your first customer via Quick Complete →
            </Link>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {requests.map((req) => {
            const trackingUrl = req.token ? `/r/${req.token}` : ''
            const isHighlighted = highlightedRowId === req.id

            return (
              <div
                key={req.id}
                className={`p-6 transition-colors duration-500 motion-reduce:transition-none ${
                  isHighlighted
                    ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500/40'
                    : 'hover:bg-slate-800/30'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-white text-base">{req.customerName}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-all duration-300 motion-reduce:transition-none ${
                          req.status === 'CLICKED'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : req.status === 'SENT'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : req.status === 'FAILED'
                            ? 'bg-rose-950 text-rose-400 border border-rose-800'
                            : req.status === 'SCHEDULED'
                            ? 'bg-amber-950 text-amber-400 border border-amber-800'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        } ${isHighlighted ? 'ring-2 ring-blue-400/50 scale-105' : ''}`}
                      >
                        {req.status}
                      </span>
                      <span className="text-xs text-slate-500 uppercase">{req.channel}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-4">
                      <span>Email: {req.recipientEmail}</span>
                      <span>Created: {new Date(req.created_at).toLocaleString()}</span>
                      {req.clicked_at && (
                        <span className="text-emerald-400 font-medium">
                          Clicked: {new Date(req.clicked_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {trackingUrl && req.status !== 'FAILED' && req.status !== 'SCHEDULED' && (
                      <a
                        href={trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors"
                      >
                        Test Link ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Inline Development Email Representation */}
                {trackingUrl && (
                  <details className="mt-4 text-xs group">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none flex items-center gap-1.5">
                      <span className="transition-transform group-open:rotate-90">▸</span>
                      <span className="font-medium underline">Inspect Development Email Representation</span>
                      <span className="text-slate-500 font-normal">(ConsoleEmailProvider / Live Disabled)</span>
                    </summary>

                    <div className="mt-3 p-4 bg-slate-950 border border-slate-800 rounded-md font-mono text-slate-300 space-y-2">
                      <div className="text-slate-500 text-[11px] pb-1 border-b border-slate-900 flex justify-between">
                        <span>DEVELOPMENT EMAIL PREVIEW</span>
                        <span>Channel: {req.channel}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">To:</span> {req.recipientEmail}
                      </div>
                      <div>
                        <span className="text-slate-500">Subject:</span> How was your experience with {orgName}?
                      </div>
                      <div className="pt-2 text-slate-200 whitespace-pre-line border-t border-slate-900">
                        {`Hi ${req.customerName || 'there'},

Thanks for choosing ${orgName}.

If you'd like to share your experience, we'd appreciate your honest feedback.

Leave a review:
${trackingUrl}

Thank you,
${orgName}`}
                      </div>
                      <div className="pt-2 text-[11px] text-slate-500 border-t border-slate-900 flex items-center justify-between">
                        <span>Delivery Provider: ConsoleEmailProvider</span>
                        <a
                          href={trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          Click to test tracked 302 redirect →
                        </a>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
