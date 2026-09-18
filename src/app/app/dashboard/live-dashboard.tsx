'use client'

import React, { useEffect, useReducer, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getDashboardSnapshot, getActivityRowProjection, getCompletionActivityProjection } from '@/actions/dashboard'
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
  ReviewRequestCheckingEvent,
} from '@/lib/dashboard/realtime-types'
import { RealtimeStatus } from './realtime-status'
import { DashboardKpis } from './dashboard-kpis'
import { LiveActivity } from './live-activity'
import { RecentActivity } from './recent-activity'
import { SystemStatusCard } from './system-status-card'
import { NeedsAttentionCard } from './needs-attention-card'
import { QuickLinksCard } from './quick-links-card'

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
  const reconcile = useCallback(
    async (reason: 'reconnect' | 'focus' = 'reconnect') => {
      dispatch({ type: 'SET_CONNECTION_STATE', connectionState: 'SYNCING' })
      try {
        const snapshot = await getDashboardSnapshot(orgId)
        if (snapshot) {
          dispatch({
            type: 'SNAPSHOT_RECONCILED',
            snapshot,
            reason,
            preserveLiveActivity: reason === 'focus',
          })
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
          async (msg: { payload: CustomerCompletedEvent }) => {
            if (msg.payload) {
              dispatch({ type: 'EVENT_RECEIVED', event: msg.payload })

              if (msg.payload.completionEventId) {
                try {
                  const proj = await getCompletionActivityProjection(
                    orgId,
                    msg.payload.completionEventId
                  )
                  if (proj && isMounted) {
                    dispatch({
                      type: 'SET_LIVE_ACTIVITY_CUSTOMER',
                      completionEventId: msg.payload.completionEventId,
                      customerName: proj.customerName,
                    })
                  }
                } catch {
                  // Gracefully keep fallback label
                }
              }
            }
          }
        )
        .on(
          'broadcast',
          { event: 'review_request.checking' },
          (msg: { payload: ReviewRequestCheckingEvent }) => {
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
              reconcile('reconnect')
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
          reconcile('focus')
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
            <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
            <RealtimeStatus status={state.connectionState} />
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Realtime activity, automation state, and operational metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/quick-complete"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-transparent rounded-md shadow-sm text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            + Quick Complete
          </Link>
        </div>
      </div>

      {/* KPI Metric Row — Primary Scannable Metrics */}
      <DashboardKpis kpis={state.kpis} highlightedKey={state.highlightedKpiKey} />

      {/* Main Two-Column Operational Area */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        {/* Left / Primary Column on Desktop */}
        <div className="order-1 lg:order-1 lg:col-start-1 lg:row-start-1 space-y-6 min-w-0">
          <LiveActivity activities={state.liveActivity} />
          <div className="hidden lg:block">
            <RecentActivity
              requests={state.recentRequests}
              orgName={orgName}
              highlightedRowId={state.highlightedRowId}
            />
          </div>
        </div>

        {/* Right / Secondary Sidebar on Desktop (Mobile Order 2 & 3) */}
        <div className="order-2 lg:order-2 lg:col-start-2 lg:row-start-1 space-y-6">
          <SystemStatusCard
            status={state.systemStatus}
            statusDescription={state.statusDescription}
            failedCount={state.kpis.failedCount}
            locationsNeedingDestinationCount={initialSnapshot.locationsNeedingDestinationCount}
          />
          <NeedsAttentionCard items={state.attentionItems} />
          <div className="hidden lg:block">
            <QuickLinksCard />
          </div>
        </div>

        {/* Mobile-only Order 5: Recent Review Solicitations */}
        <div className="order-3 lg:hidden min-w-0">
          <RecentActivity
            requests={state.recentRequests}
            orgName={orgName}
            highlightedRowId={state.highlightedRowId}
          />
        </div>

        {/* Mobile-only Order 6: Quick Links */}
        <div className="order-4 lg:hidden">
          <QuickLinksCard />
        </div>
      </div>
    </div>
  )
}
