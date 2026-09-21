'use client'

import React, { useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  getDashboardSnapshot,
  getActivityRowProjection,
  getCompletionActivityProjection,
} from '@/actions/dashboard'
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
import { DashboardKpis } from './dashboard-kpis'
import { ActivityPanel } from './activity-panel'
import { SystemStatusPanel } from './system-status-panel'
import { CalendarIcon, ChevronDownIcon, PlusCircleIcon } from '@/components/ui/icons'
import { PageShell } from '@/components/layout/page-shell'
import { useModal } from '@/components/ui/modal-system'

interface LiveDashboardProps {
  initialSnapshot: DashboardSnapshot
  orgId: string
  orgName: string
  renderedAt?: string
}

export function LiveDashboard({
  initialSnapshot,
  orgId,
  orgName,
  renderedAt,
}: LiveDashboardProps) {
  const { openQuickComplete } = useModal()
  const supabase = useMemo(() => createClient(), [])
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
            preserveLiveActivity: true,
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
    },
    [orgId]
  )

  // Realtime subscription setup
  useEffect(() => {
    let isMounted = true
    let activeChannel: ReturnType<typeof supabase.channel> | null = null

    async function initRealtime() {
      // 1. Ensure client-side Supabase JWT is propagated to realtime connection before subscribe
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!isMounted) return

      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token)
      }

      if (!isMounted) return

      // 2. Private organization dashboard broadcast channel: organization:{orgId}:dashboard
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
                      policyReason: proj.policyReason,
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
          async (msg: { payload: ReviewRequestIneligibleEvent }) => {
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
                      policyReason: proj.policyReason,
                    })
                  }
                } catch {
                  // Gracefully keep current labels
                }
              }
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
  }, [orgId, reconcile, supabase])

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

  const attentionCount = state.attentionItems.length

  // Format current date e.g. "Apr 22, 2025"
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(renderedAt ? new Date(renderedAt) : new Date())

  return (
    <PageShell>
      {/* Screen reader live announcement */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </div>

      <div className="space-y-5 xl:space-y-6 flex-1 flex flex-col min-w-0 min-h-0">
        {/* ============================================================== */}
        {/* 1. DESKTOP & TABLET PAGE HEADER                                */}
        {/* ============================================================== */}
        <div className="hidden md:flex flex-row items-center justify-between gap-4">
          <div>
            <div className="text-xs xl:text-sm text-slate-400 font-medium">Good morning,</div>
            <h1 className="text-xl xl:text-2xl font-bold text-white tracking-tight mt-0.5">
              {orgName}
            </h1>
            <p className="text-xs xl:text-sm text-slate-400 mt-1">
              Your reputation is in good shape.{' '}
              {attentionCount > 0 ? (
                <>
                  <span className="text-amber-400 font-semibold">
                    {attentionCount} {attentionCount === 1 ? 'item' : 'items'}
                  </span>{' '}
                  need your attention.
                </>
              ) : (
                'All systems operational.'
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Realtime Status Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0E162B] border border-[#1C2846] text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  state.connectionState === 'LIVE'
                    ? 'bg-emerald-400 animate-pulse'
                    : state.connectionState === 'SYNCING'
                    ? 'bg-blue-400 animate-spin'
                    : 'bg-amber-400'
                }`}
                aria-hidden="true"
              />
              <span className="text-slate-300 font-medium capitalize">
                {state.connectionState.toLowerCase()}
              </span>
            </div>

            {/* Date Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0E162B] border border-[#1C2846] text-xs text-slate-300">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
              <span>{formattedDate}</span>
            </div>

            {/* Action Menu / Trigger */}
            <Link
              href="/app/quick-complete"
              onClick={(e) => {
                e.preventDefault()
                openQuickComplete()
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors shadow-sm shadow-blue-900/30"
            >
              <span>+ Quick Complete</span>
              <ChevronDownIcon className="w-3 h-3 text-blue-200" />
            </Link>
          </div>
        </div>

        {/* ============================================================== */}
        {/* 2. MOBILE GREETING & FULL-WIDTH QUICK COMPLETE (< 768px)       */}
        {/* ============================================================== */}
        <div className="md:hidden space-y-3.5">
          <div>
            <div className="text-xs text-slate-400 font-medium">Good morning,</div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-1.5 mt-0.5">
              <span>{orgName}</span>
              <span aria-hidden="true">👋</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Here&apos;s what&apos;s happening with your reputation today.
            </p>
          </div>

          {/* Mobile Full-Width Dominant Quick Complete Action Button */}
          <Link
            href="/app/quick-complete"
            onClick={(e) => {
              e.preventDefault()
              openQuickComplete()
            }}
            className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30 text-sm transition-colors"
          >
            <PlusCircleIcon className="w-4.5 h-4.5" />
            <span>Quick Complete</span>
          </Link>
        </div>

        {/* ============================================================== */}
        {/* 3. KPI METRIC ROW (5 cards on Desktop/Tablet, 2x2+1 on Mobile) */}
        {/* ============================================================== */}
        <DashboardKpis kpis={state.kpis} highlightedKey={state.highlightedKpiKey} />

        {/* ============================================================== */}
        {/* 4. MAIN OPERATIONAL GRID                                       */}
        {/* Desktop: ~68% Left Activity / ~32% Right Status                */}
        {/* Tablet: Side-by-side 50/50                                     */}
        {/* Mobile: Stacked Activity then Status                           */}
        {/* ============================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-stretch xl:flex-1 xl:min-h-0">
          {/* Unified Recent Activity Panel (Tabs: Live Activity / Solicitations) */}
          <div className="min-w-0 h-full">
            <ActivityPanel
              liveActivities={state.liveActivity}
              recentRequests={state.recentRequests}
              orgName={orgName}
              highlightedRowId={state.highlightedRowId}
              renderedAt={renderedAt || initialSnapshot.renderedAt}
            />
          </div>

          {/* Unified System Status Panel (Status, Attention, Checklist/Summary) */}
          <div className="min-w-0 h-full">
            <SystemStatusPanel
              status={state.systemStatus}
              statusDescription={state.statusDescription}
              attentionItems={state.attentionItems}
              checklist={state.setupChecklist}
              failedCount={state.kpis.failedCount}
              locationsNeedingDestinationCount={state.locationsNeedingDestinationCount}
            />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
