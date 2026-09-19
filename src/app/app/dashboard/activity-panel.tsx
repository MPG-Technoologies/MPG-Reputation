'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import type { LiveActivityItem, ActivityRequestItem } from '@/lib/dashboard/realtime-types'
import {
  CheckCircleIcon,
  PaperPlaneIcon,
  LinkIcon,
  DocumentIcon,
  ClockIcon,
  AlertTriangleIcon,
} from '@/components/ui/icons'

export interface ActivityPanelProps {
  liveActivities: LiveActivityItem[]
  recentRequests: ActivityRequestItem[]
  orgName: string
  highlightedRowId?: string | null
}

const STATUS_BADGES: Record<string, string> = {
  CLICKED: 'bg-teal-950/70 text-teal-300 border-teal-800/80',
  SENT: 'bg-blue-950/70 text-blue-300 border-blue-800/80',
  DELIVERED: 'bg-sky-950/70 text-sky-300 border-sky-800/80',
  FAILED: 'bg-rose-950/70 text-rose-300 border-rose-800/80',
  SCHEDULED: 'bg-amber-950/70 text-amber-300 border-amber-800/80',
}

function formatRelativeTime(dateString: string): string {
  try {
    const diffMs = Date.now() - new Date(dateString).getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return 'just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`
    const diffDays = Math.floor(diffHour / 24)
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`
  } catch {
    return 'recently'
  }
}

export const ActivityPanel = React.memo(function ActivityPanel({
  liveActivities = [],
  recentRequests = [],
  orgName,
  highlightedRowId,
}: ActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<'live' | 'solicitations'>('live')

  // Combine real liveActivities and recentRequests into a unified chronological event list for the Live tab
  const liveEvents = useMemo(() => {
    interface DisplayEvent {
      id: string
      type: 'completed' | 'sent' | 'clicked' | 'eligible' | 'checking' | 'failed'
      title: string
      subtitle: string
      timestamp: string
      icon: React.ComponentType<{ className?: string }>
      badgeStyle: string
      iconColor: string
    }

    const events: DisplayEvent[] = []

    // Map realtime live activities
    for (const act of liveActivities) {
      if (act.stage === 'RECEIVED') {
        events.push({
          id: `live-${act.completionEventId}-rec`,
          type: 'completed',
          title: 'Customer completed',
          subtitle: `${act.customerName} – Recorded completion`,
          timestamp: act.createdAt,
          icon: CheckCircleIcon,
          badgeStyle: 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-400',
          iconColor: '#10B981',
        })
      } else if (act.stage === 'CHECKING' || act.stage === 'PREPARING') {
        events.push({
          id: `live-${act.completionEventId}-chk`,
          type: 'eligible',
          title: 'Eligible for request',
          subtitle: `${act.customerName} – Evaluating rules`,
          timestamp: act.updatedAt || act.createdAt,
          icon: DocumentIcon,
          badgeStyle: 'bg-blue-950/60 border border-blue-800/60 text-blue-400',
          iconColor: '#3B82F6',
        })
      } else if (act.stage === 'SENT') {
        events.push({
          id: `live-${act.completionEventId}-sent`,
          type: 'sent',
          title: 'Invitation sent',
          subtitle: `${act.customerName} – Review request dispatched`,
          timestamp: act.updatedAt || act.createdAt,
          icon: PaperPlaneIcon,
          badgeStyle: 'bg-sky-950/60 border border-sky-800/60 text-sky-400',
          iconColor: '#0EA5E9',
        })
      } else if (act.stage === 'FAILED') {
        events.push({
          id: `live-${act.completionEventId}-fail`,
          type: 'failed',
          title: 'Dispatch failed',
          subtitle: `${act.customerName} – Delivery error`,
          timestamp: act.updatedAt || act.createdAt,
          icon: AlertTriangleIcon,
          badgeStyle: 'bg-rose-950/60 border border-rose-800/60 text-rose-400',
          iconColor: '#EF4444',
        })
      }
    }

    // Map historical recentRequests if live list is small
    for (const req of recentRequests) {
      if (req.clicked_at) {
        events.push({
          id: `req-${req.id}-click`,
          type: 'clicked',
          title: 'Feedback link clicked',
          subtitle: `${req.customerName} – Visited destination`,
          timestamp: req.clicked_at,
          icon: LinkIcon,
          badgeStyle: 'bg-teal-950/60 border border-teal-800/60 text-teal-400',
          iconColor: '#14B8A6',
        })
      }
      if (req.sent_at) {
        events.push({
          id: `req-${req.id}-sent`,
          type: 'sent',
          title: 'Invitation sent',
          subtitle: `${req.customerName} – Via ${req.channel}`,
          timestamp: req.sent_at,
          icon: PaperPlaneIcon,
          badgeStyle: 'bg-blue-950/60 border border-blue-800/60 text-blue-400',
          iconColor: '#3B82F6',
        })
      } else if (req.status === 'SCHEDULED') {
        events.push({
          id: `req-${req.id}-sched`,
          type: 'eligible',
          title: 'Eligible for request',
          subtitle: `${req.customerName} – Scheduled for delivery`,
          timestamp: req.created_at,
          icon: ClockIcon,
          badgeStyle: 'bg-purple-950/60 border border-purple-800/60 text-purple-400',
          iconColor: '#A855F7',
        })
      } else {
        events.push({
          id: `req-${req.id}-created`,
          type: 'completed',
          title: 'Customer completed',
          subtitle: `${req.customerName} – Workflow initiated`,
          timestamp: req.created_at,
          icon: CheckCircleIcon,
          badgeStyle: 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-400',
          iconColor: '#10B981',
        })
      }
    }

    // Sort descending by timestamp
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Unique by ID and limit to 7 for clean dashboard viewport fit
    const seen = new Set<string>()
    const deduped: DisplayEvent[] = []
    for (const e of events) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        deduped.push(e)
      }
    }
    return deduped.slice(0, 7)
  }, [liveActivities, recentRequests])

  return (
    <div className="bg-[#0E172B] border border-[#1C2846] rounded-xl overflow-hidden flex flex-col justify-between h-full">
      {/* ============================================================== */}
      {/* Panel Header & Navigation Tabs                                  */}
      {/* ============================================================== */}
      <div className="px-5 pt-4 pb-0 border-b border-[#1C2846]/80">
        <div className="flex items-center justify-between pb-3">
          <div>
            <h2 className="text-base font-semibold text-white tracking-tight">Recent Activity</h2>
            {/* Tablet-only subtitle matching reference */}
            <p className="hidden md:block xl:hidden text-xs text-slate-400 mt-0.5">
              Live updates from your reputation campaigns.
            </p>
          </div>

          {/* Desktop & Tablet Header Extras */}
          <div className="flex items-center gap-3">
            {/* Desktop: pulsating live indicator */}
            <div className="hidden xl:flex items-center gap-2 text-xs font-medium text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Updates</span>
            </div>

            {/* Tablet: View All link in header */}
            <Link
              href="/app/customers"
              className="hidden md:inline-flex xl:hidden text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              View All
            </Link>

            {/* Mobile: See All > link in header */}
            <Link
              href="/app/customers"
              className="inline-flex md:hidden text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              See All &gt;
            </Link>
          </div>
        </div>

        {/* Tab Controls (Desktop & Tablet) */}
        <div className="flex items-center gap-2 sm:gap-4 text-xs font-medium border-t border-[#1C2846]/40 pt-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('live')}
            className={`pb-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'live'
                ? 'border-blue-500 text-white font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Activity
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('solicitations')}
            className={`pb-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'solicitations'
                ? 'border-blue-500 text-white font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Recent Solicitations
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* Tab Content: Live Activity                                      */}
      {/* ============================================================== */}
      {activeTab === 'live' && (
        <div className="divide-y divide-[#1C2846]/60 flex-1">
          {liveEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No recent activity recorded yet for {orgName}.
              <div className="mt-2">
                <Link
                  href="/app/quick-complete"
                  className="text-blue-400 hover:text-blue-300 text-xs font-medium underline"
                >
                  Record a customer completion →
                </Link>
              </div>
            </div>
          ) : (
            // Render up to 5 on mobile, 7 on desktop
            liveEvents.slice(0, 7).map((evt, idx) => {
              const Icon = evt.icon
              // Mobile hides items beyond index 2 (showing bounded 3 on phone per reference)
              const mobileHidden = idx >= 3 ? 'hidden md:flex' : 'flex'

              return (
                <div
                  key={evt.id}
                  className={`${mobileHidden} items-center justify-between px-5 py-3 xl:py-3.5 hover:bg-[#131E38]/50 transition-colors`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${evt.badgeStyle}`}
                      aria-hidden="true"
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs xl:text-sm font-semibold text-white truncate">
                        {evt.title}
                      </div>
                      <div className="text-[11px] xl:text-xs text-slate-400 truncate mt-0.5">
                        {evt.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 shrink-0 ml-3 text-right whitespace-nowrap">
                    {formatRelativeTime(evt.timestamp)}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* Tab Content: Recent Solicitations                               */}
      {/* ============================================================== */}
      {activeTab === 'solicitations' && (
        <div className="flex-1 overflow-x-auto">
          {recentRequests.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No review invitations sent yet for {orgName}.
              <div className="mt-2">
                <Link
                  href="/app/quick-complete"
                  className="text-blue-400 hover:text-blue-300 text-xs font-medium underline"
                >
                  Start your first solicitation →
                </Link>
              </div>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0A1020] text-slate-400 uppercase tracking-wider text-[10px] border-b border-[#1C2846]">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Customer</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Channel</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-right">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2846]/60">
                {recentRequests.slice(0, 7).map((req) => {
                  const trackingUrl = req.token ? `/r/${req.token}` : null
                  const isHighlighted = highlightedRowId === req.id
                  const statusStyle =
                    STATUS_BADGES[req.status] || 'bg-slate-800 text-slate-300 border-slate-700'

                  return (
                    <tr
                      key={req.id}
                      className={`hover:bg-[#131E38]/50 transition-colors ${
                        isHighlighted ? 'bg-blue-950/40 ring-1 ring-inset ring-blue-500/40' : ''
                      }`}
                    >
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-white text-xs">{req.customerName}</div>
                        <div className="text-[10px] text-slate-400">{req.recipientEmail}</div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#131E38] text-slate-300 border border-[#1C2846]">
                          {req.channel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusStyle}`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap text-[11px]">
                        {formatRelativeTime(req.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {trackingUrl ? (
                          <a
                            href={trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-medium text-[11px] inline-flex items-center gap-1"
                          >
                            Test Link ↗
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* Panel Footer (Desktop & Tablet)                                 */}
      {/* ============================================================== */}
      <div className="px-5 py-3 border-t border-[#1C2846]/80 flex items-center justify-between text-xs text-slate-400 bg-[#0A1020]/40">
        <span>Showing latest activity from today</span>
        <Link
          href="/app/customers"
          className="text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1"
        >
          <span>View All Activity</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  )
})
