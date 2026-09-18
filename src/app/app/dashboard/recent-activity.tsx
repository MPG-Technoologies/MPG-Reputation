'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import type { ActivityRequestItem } from '@/lib/dashboard/realtime-types'
import { CodeIcon } from '@/components/ui/icons'

interface RecentActivityProps {
  requests: ActivityRequestItem[]
  orgName: string
  highlightedRowId: string | null
}

const STATUS_BADGES: Record<string, string> = {
  CLICKED: 'bg-emerald-950 text-emerald-300 border-emerald-800/80',
  SENT: 'bg-blue-950 text-blue-300 border-blue-800/80',
  FAILED: 'bg-rose-950 text-rose-300 border-rose-800/80',
  SCHEDULED: 'bg-amber-950 text-amber-300 border-amber-800/80',
}

export const RecentActivity = React.memo(function RecentActivity({
  requests,
  orgName,
  highlightedRowId,
}: RecentActivityProps) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedRowId((curr) => (curr === id ? null : id))
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Recent Review Solicitations</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Inspect sent requests, view development email previews, and test tracked redirects.
          </p>
        </div>
        <span className="text-xs text-slate-500 font-medium">Last 10 events</span>
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
        <>
          {/* Desktop & Tablet: Compact Scannable Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Channel</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Created</th>
                  <th scope="col" className="px-4 py-3 font-medium">Clicked</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {requests.map((req) => {
                  const trackingUrl = req.token ? `/r/${req.token}` : ''
                  const isHighlighted = highlightedRowId === req.id
                  const isExpanded = expandedRowId === req.id
                  const statusStyle =
                    STATUS_BADGES[req.status] ||
                    'bg-slate-800 text-slate-300 border-slate-700'

                  return (
                    <React.Fragment key={req.id}>
                      <tr
                        className={`transition-colors duration-300 motion-reduce:transition-none ${
                          isHighlighted
                            ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500/40'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="font-semibold text-white text-xs">
                            {req.customerName}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {req.recipientEmail}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                            {req.channel}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${statusStyle} ${
                              isHighlighted ? 'ring-2 ring-blue-400/50 scale-105' : ''
                            }`}
                          >
                            {req.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-slate-400 text-[11px]">
                          {new Date(req.created_at).toLocaleString([], {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-[11px]">
                          {req.clicked_at ? (
                            <span className="text-emerald-400 font-medium">
                              {new Date(req.clicked_at).toLocaleString([], {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            {trackingUrl && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(req.id)}
                                className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border transition-colors ${
                                  isExpanded
                                    ? 'bg-slate-800 text-white border-slate-600'
                                    : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
                                }`}
                                title="Inspect Development Email Representation"
                              >
                                <CodeIcon className="w-3 h-3" />
                                <span>Preview</span>
                              </button>
                            )}

                            {trackingUrl &&
                              req.status !== 'FAILED' &&
                              req.status !== 'SCHEDULED' && (
                                <a
                                  href={trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded transition-colors"
                                >
                                  Test Link ↗
                                </a>
                              )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable In-Row Development Email Drawer */}
                      {isExpanded && trackingUrl && (
                        <tr className="bg-slate-950/80">
                          <td colSpan={6} className="px-5 py-3 border-t border-slate-800">
                            <div className="p-4 bg-slate-950 border border-slate-800 rounded-md font-mono text-xs text-slate-300 space-y-2">
                              <div className="text-slate-500 text-[11px] pb-1 border-b border-slate-900 flex justify-between">
                                <span>DEVELOPMENT EMAIL PREVIEW</span>
                                <span>(ConsoleEmailProvider / Live Disabled)</span>
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
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: Compact Stacked Cards */}
          <div className="md:hidden divide-y divide-slate-800">
            {requests.map((req) => {
              const trackingUrl = req.token ? `/r/${req.token}` : ''
              const isHighlighted = highlightedRowId === req.id
              const statusStyle =
                STATUS_BADGES[req.status] ||
                'bg-slate-800 text-slate-300 border-slate-700'

              return (
                <div
                  key={req.id}
                  className={`p-4 space-y-3 transition-colors ${
                    isHighlighted
                      ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500/40'
                      : 'hover:bg-slate-800/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-white text-sm">
                        {req.customerName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {req.recipientEmail}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                        {req.channel}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${statusStyle}`}
                      >
                        {req.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                    <span>
                      Created: {new Date(req.created_at).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                    {req.clicked_at && (
                      <span className="text-emerald-400 font-medium">
                        Clicked: {new Date(req.clicked_at).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    )}
                  </div>

                  {/* Actions on Mobile */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    {trackingUrl && (
                      <details className="text-xs group w-full">
                        <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none flex items-center gap-1.5 py-1">
                          <span className="transition-transform group-open:rotate-90">▸</span>
                          <span className="font-medium underline">Inspect Development Email Representation</span>
                        </summary>
                        <div className="mt-2 p-3 bg-slate-950 border border-slate-800 rounded-md font-mono text-[11px] text-slate-300 space-y-2">
                          <div className="text-slate-500 text-[10px] pb-1 border-b border-slate-900 flex justify-between">
                            <span>DEVELOPMENT EMAIL PREVIEW</span>
                            <span>(ConsoleEmailProvider)</span>
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
                          <div className="pt-2 text-[10px] text-slate-500 border-t border-slate-900">
                            Delivery Provider: ConsoleEmailProvider
                          </div>
                        </div>
                      </details>
                    )}

                    {trackingUrl &&
                      req.status !== 'FAILED' &&
                      req.status !== 'SCHEDULED' && (
                        <a
                          href={trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors whitespace-nowrap ml-auto"
                        >
                          Test Link ↗
                        </a>
                      )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
})
