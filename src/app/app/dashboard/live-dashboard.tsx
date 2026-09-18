'use client'

import React, { useEffect, useReducer, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getDashboardSnapshot, getActivityRowProjection } from '@/actions/dashboard'
import {
  createInitialState,
  dashboardReducer,
} from '@/lib/dashboard/dashboard-reducer'
import type {
  DashboardSnapshot,
  CustomerCompletedEvent,
  ReviewRequestCreatedEvent,
  ReviewRequestUpdatedEvent,
  ReviewRequestIneligibleEvent,
} from '@/lib/dashboard/realtime-types'
import { RealtimeStatus } from './realtime-status'
import { DashboardKpis } from './dashboard-kpis'
import { RecentActivity } from './recent-activity'

interface LiveDashboardProps {
  initialSnapshot: DashboardSnapshot
  orgId: string
  orgName: string
}

export function LiveDashboard({
  initialSnapshot,
  orgId,
  orgName,
}: LiveDashboardProps) {
  const [state, dispatch] = useReducer(
    dashboardReducer,
    initialSnapshot,
    (snap) => createInitialState(orgId, snap)
  )

  const isSubscribedRef = useRef(false)
  const hasConnectedOnce = useRef(false)
  const lastReconciledAt = useRef(0)
  const hiddenAt = useRef<number | null>(null)

  // Narrow authoritative reconciliation
  const reconcile = useCallback(async () => {
    dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'SYNCING' })
    try {
      const snapshot = await getDashboardSnapshot(orgId)
      if (snapshot) {
        dispatch({ type: 'SNAPSHOT_RECONCILED', snapshot })
        if (isSubscribedRef.current) {
          dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'LIVE' })
        } else {
          dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'RECONNECTING' })
        }
      } else {
        // Failed snapshot fetch: retain existing data, show non-live state
        dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'RECONNECTING' })
      }
    } catch {
      // Failed: retain existing state, do not falsely claim LIVE
      dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'RECONNECTING' })
    } finally {
      lastReconciledAt.current = Date.now()
    }
  }, [orgId])

  // Single organization-scoped Realtime channel subscription with explicit setAuth bootstrap
  useEffect(() => {
    const supabase = createClient()
    let isMounted = true
    let activeChannel: ReturnType<typeof supabase.channel> | null = null

    const initRealtime = async () => {
      try {
        // Explicitly initialize Realtime authorization using the authenticated client
        const {
          data: { session },
        } = await supabase.auth.getSession()
        await supabase.realtime.setAuth(session?.access_token ?? undefined)
      } catch {
        // Fall back gracefully to client defaults
      }

      if (!isMounted) return

      const topic = `organization:${orgId}:dashboard`
      const channel = supabase.channel(topic, {
        config: {
          private: true,
          broadcast: { ack: false },
        },
      })
      activeChannel = channel

      channel
        .on(
          'broadcast',
          { event: 'customer.completed' },
          (msg: { payload: CustomerCompletedEvent }) => {
            if (msg.payload) {
              dispatch({ type: 'EVENT_RECEIVED', event: msg.payload })
            }
          }
        )
        .on(
          'broadcast',
          { event: 'review_request.created' },
          async (msg: { payload: ReviewRequestCreatedEvent }) => {
            if (msg.payload) {
              dispatch({ type: 'EVENT_RECEIVED', event: msg.payload })

              // Asynchronously populate customer display projection for new row
              try {
                const proj = await getActivityRowProjection(orgId, msg.payload.requestId)
                if (proj && isMounted) {
                  dispatch({
                    type: 'SET_SINGLE_ROW_CUSTOMER',
                    requestId: msg.payload.requestId,
                    customerName: proj.customerName,
                    recipientEmail: proj.recipientEmail,
                    token: proj.token,
                  })
                }
              } catch {
                // Gracefully keep fallback labels
              }
            }
          }
        )
        .on(
          'broadcast',
          { event: 'review_request.updated' },
          (msg: { payload: ReviewRequestUpdatedEvent }) => {
            if (msg.payload) {
              dispatch({ type: 'EVENT_RECEIVED', event: msg.payload })
            }
          }
        )
        .on(
          'broadcast',
          { event: 'review_request.ineligible' },
          (msg: { payload: ReviewRequestIneligibleEvent }) => {
            if (msg.payload) {
              dispatch({ type: 'EVENT_RECEIVED', event: msg.payload })
            }
          }
        )
        .subscribe((status) => {
          if (!isMounted) return

          if (status === 'SUBSCRIBED') {
            isSubscribedRef.current = true
            dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'LIVE' })
            if (hasConnectedOnce.current) {
              // Reconnection event: reconcile once
              reconcile()
            } else {
              hasConnectedOnce.current = true
            }
          } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
            isSubscribedRef.current = false
            dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'RECONNECTING' })
          } else if (status === 'CLOSED') {
            isSubscribedRef.current = false
            dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'OFFLINE' })
          }
        })
    }

    initRealtime()

    return () => {
      isMounted = false
      isSubscribedRef.current = false
      if (activeChannel) {
        supabase.removeChannel(activeChannel)
      }
    }
  }, [orgId, reconcile])

  // Lifecycle focus / visibility reconciliation (throttled, only if hidden > 15s)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
      } else if (document.visibilityState === 'visible') {
        const wasHiddenDuration = hiddenAt.current ? Date.now() - hiddenAt.current : 0
        hiddenAt.current = null

        // Only reconcile if hidden for a meaningful period (>15s) and not reconciled in the last 10s
        if (wasHiddenDuration > 15_000 && Date.now() - lastReconciledAt.current > 10_000) {
          reconcile()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [reconcile])

  // Clear visual micro-highlights after 600ms
  useEffect(() => {
    if (state.highlightedKpiKey || state.highlightedRowId) {
      const timer = setTimeout(() => {
        dispatch({ type: 'CLEAR_HIGHLIGHTS' })
      }, 600)
      return () => clearTimeout(timer)
    }
  }, [state.highlightedKpiKey, state.highlightedRowId])

  return (
    <div className="space-y-6">
      {/* Screen reader live announcement */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </div>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">{orgName} Dashboard</h1>
            <RealtimeStatus status={state.connectionState} />
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Truthful activity, automation state, and operational metrics for V0.2 Controlled Staging.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/quick-complete"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            + Quick Complete
          </Link>
        </div>
      </div>

      {/* Truthful System Readiness Status Banner */}
      <div
        className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
          state.systemStatus === 'SETUP_REQUIRED'
            ? 'bg-amber-950/40 border-amber-800/60'
            : state.systemStatus === 'NEEDS_ATTENTION'
            ? 'bg-rose-950/40 border-rose-800/60'
            : state.systemStatus === 'READY_FOR_SYNTHETIC_TEST'
            ? 'bg-blue-950/40 border-blue-800/60'
            : 'bg-emerald-950/40 border-emerald-800/60'
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="text-lg">
            {state.systemStatus === 'SETUP_REQUIRED' && '⚙️'}
            {state.systemStatus === 'NEEDS_ATTENTION' && '⚠️'}
            {state.systemStatus === 'READY_FOR_SYNTHETIC_TEST' && '🧪'}
            {state.systemStatus === 'RUNNING' && '✅'}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                {state.systemStatus}
              </span>
              <span className="text-xs text-slate-400">V0.2 Controlled Staging</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">{state.statusDescription}</p>
          </div>
        </div>
        {initialSnapshot.locationsNeedingDestinationCount > 0 && (
          <Link
            href="/app/settings/review-destination"
            className="text-xs font-medium bg-amber-800 hover:bg-amber-700 text-amber-100 px-3 py-1.5 rounded transition-colors whitespace-nowrap"
          >
            Configure Destination →
          </Link>
        )}
      </div>

      {/* Needs Attention Section */}
      {state.attentionItems.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span>⚠️</span> Needs Attention
            </h2>
            <span className="text-xs text-slate-500">{state.attentionItems.length} condition(s) detected</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {state.attentionItems.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-md border text-sm flex flex-col justify-between ${
                  item.severity === 'error'
                    ? 'bg-rose-950/30 border-rose-800/60 text-rose-200'
                    : item.severity === 'warning'
                    ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                    : 'bg-blue-950/30 border-blue-800/60 text-blue-200'
                }`}
              >
                <div>
                  <div className="font-semibold text-white mb-1">{item.title}</div>
                  <p className="text-xs opacity-90 leading-relaxed">{item.description}</p>
                </div>
                {item.actionHref && item.actionLabel && (
                  <div className="mt-3">
                    <Link
                      href={item.actionHref}
                      className="text-xs font-medium underline hover:text-white transition-colors"
                    >
                      {item.actionLabel}
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Metric Cards with Live Realtime Updates */}
      <DashboardKpis kpis={state.kpis} highlightedKey={state.highlightedKpiKey} />

      {/* Automation & Integrity Invariants */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <h2 className="text-base font-semibold text-white mb-4">Automation &amp; Integrity Invariants</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-slate-300">Neutral Solicitation: <strong className="text-white">Active</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-slate-300">Review Gating: <strong className="text-white">Disabled (Strict)</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                state.kpis.failedCount > 0 ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
            ></span>
            <span className="text-slate-300">
              Failed Dispatches: <strong className="text-white">{state.kpis.failedCount}</strong>
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-4">
          Truthful Guarantee: MPG Reputation never fabricates reviews received, star ratings, or ROI metrics. A tracked click is recorded only as a link click.
        </p>
      </div>

      {/* Recent Activity Table with Live Updates */}
      <RecentActivity
        requests={state.recentRequests}
        orgName={orgName}
        highlightedRowId={state.highlightedRowId}
      />
    </div>
  )
}
