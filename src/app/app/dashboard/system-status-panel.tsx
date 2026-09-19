'use client'

import React from 'react'
import Link from 'next/link'
import type {
  SystemStatus,
  AttentionItem,
  SetupChecklistItem,
} from '@/lib/dashboard/realtime-types'
import {
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
  ChevronRightIcon,
  BoltIcon,
  CheckCircleIcon,
} from '@/components/ui/icons'

export interface SystemStatusPanelProps {
  status: SystemStatus
  statusDescription: string
  attentionItems: AttentionItem[]
  checklist?: SetupChecklistItem[]
  failedCount?: number
  locationsNeedingDestinationCount?: number
}

const STATUS_TITLES: Record<SystemStatus, { title: string; subtitle: string; dotColor: string }> = {
  RUNNING: {
    title: 'All Systems Operational',
    subtitle: 'Your reputation engine is running smoothly.',
    dotColor: 'bg-emerald-400',
  },
  READY_FOR_SYNTHETIC_TEST: {
    title: 'Engine Ready for Testing',
    subtitle: 'Prerequisites met. Ready for synthetic validation.',
    dotColor: 'bg-blue-400',
  },
  SETUP_REQUIRED: {
    title: 'Setup Required',
    subtitle: 'Configure locations and destinations to begin.',
    dotColor: 'bg-amber-400',
  },
  NEEDS_ATTENTION: {
    title: 'Operational Review Required',
    subtitle: 'Issues detected in recent events or dispatches.',
    dotColor: 'bg-rose-400',
  },
}

export const SystemStatusPanel = React.memo(function SystemStatusPanel({
  status,
  statusDescription,
  attentionItems = [],
  checklist = [],
}: SystemStatusPanelProps) {
  const statusInfo = STATUS_TITLES[status] || STATUS_TITLES.RUNNING

  // Calculate real checklist completion from actual checklist
  const totalChecklist = checklist.length
  const completedChecklist = checklist.filter((c) => c.complete).length
  const completionPercentage =
    totalChecklist > 0 ? Math.round((completedChecklist / totalChecklist) * 100) : 0

  return (
    <div className="bg-[#0E172B] border border-[#1C2846] rounded-xl overflow-hidden flex flex-col justify-between h-full p-5 space-y-5">
      {/* ============================================================== */}
      {/* 1. SYSTEM STATUS HEADER                                        */}
      {/* ============================================================== */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white tracking-tight">System Status</h2>
          {/* Mobile status indicator */}
          <div className="flex md:hidden items-center gap-1.5 text-xs font-medium">
            <span className={`w-2 h-2 rounded-full ${statusInfo.dotColor}`} />
            <span className="text-slate-300">{statusInfo.title}</span>
          </div>
        </div>

        {/* Desktop & Tablet status indicator */}
        <div className="hidden md:flex items-start gap-2.5 pt-1">
          <span className={`w-2.5 h-2.5 rounded-full ${statusInfo.dotColor} shrink-0 mt-1.5`} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{statusInfo.title}</div>
            <p className="text-xs text-slate-400 mt-0.5">
              {statusDescription || statusInfo.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. NEEDS ATTENTION SECTION                                      */}
      {/* ============================================================== */}
      <div className="space-y-3">
        {/* Header with Counter Badge */}
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-white">Needs Attention</div>
          {attentionItems.length > 0 ? (
            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-[11px] font-bold flex items-center justify-center">
              {attentionItems.length} {attentionItems.length === 1 ? 'issue' : 'issues'}
            </span>
          ) : (
            <span className="text-[11px] text-slate-500 font-medium">0 issues</span>
          )}
        </div>

        {/* Desktop & Tablet: Dynamic Actionable Rows */}
        <div className="hidden md:flex flex-col gap-2">
          {attentionItems.length === 0 ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[#131E38]/40 border border-[#1C2846] text-xs text-slate-400">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>All systems operational. No conditions requiring attention.</span>
            </div>
          ) : (
            attentionItems.map((item) => {
              const isError = item.severity === 'error'
              const isWarning = item.severity === 'warning'
              const href = item.actionHref || '/app/dashboard'

              return (
                <Link
                  key={item.id}
                  href={href}
                  className="flex items-center justify-between p-3 rounded-lg bg-[#131E38]/70 hover:bg-[#192748] border border-[#1C2846] transition-colors group"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div
                      className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${
                        isError
                          ? 'bg-rose-950/60 border-rose-800/60 text-rose-400'
                          : isWarning
                          ? 'bg-amber-950/60 border-amber-800/60 text-amber-400'
                          : 'bg-blue-950/60 border-blue-800/60 text-blue-400'
                      }`}
                    >
                      {isError ? (
                        <AlertCircleIcon className="w-3.5 h-3.5" />
                      ) : isWarning ? (
                        <AlertTriangleIcon className="w-3.5 h-3.5" />
                      ) : (
                        <InfoIcon className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-200 group-hover:text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <ChevronRightIcon className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0" />
                </Link>
              )
            })
          )}
        </div>

        {/* Mobile: Dynamic List of Attention Items */}
        <div className="md:hidden">
          {attentionItems.length === 0 ? (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-[#131E38]/50 border border-[#1C2846] text-xs text-slate-400">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>All systems normal. 0 issues detected.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {attentionItems.map((item) => {
                const isError = item.severity === 'error'
                const isWarning = item.severity === 'warning'
                const href = item.actionHref || '/app/dashboard'

                return (
                  <Link
                    key={item.id}
                    href={href}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#131E38]/80 border border-[#1C2846] text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div
                        className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${
                          isError
                            ? 'bg-rose-950/60 border-rose-800/60 text-rose-400'
                            : isWarning
                            ? 'bg-amber-950/60 border-amber-800/60 text-amber-400'
                            : 'bg-blue-950/60 border-blue-800/60 text-blue-400'
                        }`}
                      >
                        {isError ? (
                          <AlertCircleIcon className="w-3.5 h-3.5" />
                        ) : isWarning ? (
                          <AlertTriangleIcon className="w-3.5 h-3.5" />
                        ) : (
                          <InfoIcon className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{item.title}</div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {item.description}
                        </div>
                      </div>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 3. DESKTOP ACTIVATION CHECKLIST (>= 1280px)                     */}
      {/* ============================================================== */}
      <div className="hidden xl:block space-y-3 pt-2 border-t border-[#1C2846]/60">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Activation Checklist</span>
          <span className="text-xs text-slate-400 font-medium">
            {completedChecklist} of {totalChecklist} complete
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-[#131E38] rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>

        {/* Checklist Items */}
        <div className="space-y-2 pt-1">
          {checklist.map((item) => {
            const targetHref =
              item.id === 'active-location'
                ? '/app/settings/location'
                : item.id === 'destination-saved' || item.id === 'destination-tested'
                ? '/app/settings/review-destination'
                : '/app/dashboard'

            return (
              <Link
                key={item.id}
                href={targetHref}
                className="flex items-center justify-between py-1 text-xs text-slate-300 hover:text-white transition-colors group"
              >
                <div className="flex items-center gap-2.5 truncate">
                  {item.complete ? (
                    <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                      <CheckCircleIcon className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-slate-600 shrink-0" />
                  )}
                  <span className={`truncate ${item.complete ? 'text-slate-200' : 'text-slate-400'}`}>
                    {item.label}
                  </span>
                </div>
                <ChevronRightIcon className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />
              </Link>
            )
          })}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 4. TABLET ACTIVATION SUMMARY DONUT (768px – 1279px)            */}
      {/* ============================================================== */}
      <div className="hidden md:block xl:hidden space-y-3 pt-2 border-t border-[#1C2846]/60">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Activation Summary</span>
          <span className="text-xs text-slate-400">Readiness</span>
        </div>

        {/* Donut Visualization using Real Checklist & Location Counts */}
        <div className="flex items-center justify-around py-2">
          {/* Circular Donut Graphic */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              {/* Background Track */}
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#131E38"
                strokeWidth="3.5"
              />
              {/* Real Active Progress Arc */}
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#2563EB"
                strokeWidth="3.5"
                strokeDasharray={`${completionPercentage}, 100`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="text-base font-bold text-white leading-none">
                {completionPercentage}%
              </span>
              <span className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-wider">
                Active
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              <span>Active Ready</span>
              <span className="font-semibold text-white ml-auto">{completionPercentage}%</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-600 shrink-0" />
              <span>Pending Setup</span>
              <span className="font-semibold text-white ml-auto">
                {100 - completionPercentage}%
              </span>
            </div>
          </div>
        </div>

        {/* Tablet Tip Banner */}
        <Link
          href="/app/settings/location"
          className="flex items-center gap-2.5 p-3 rounded-lg bg-[#131E38]/80 border border-[#1C2846] text-xs hover:bg-[#192748] transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
            <BoltIcon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-slate-200 truncate">
              {statusDescription || statusInfo.subtitle}
            </div>
            <div className="text-blue-400 font-medium">Manage Settings →</div>
          </div>
        </Link>
      </div>

      {/* ============================================================== */}
      {/* 5. MOBILE STATUS TIP CARD (< 768px)                             */}
      {/* ============================================================== */}
      <div className="flex md:hidden items-center gap-2.5 p-3 rounded-xl bg-[#131E38]/70 border border-[#1C2846] text-xs">
        <span className={`w-2.5 h-2.5 rounded-full ${statusInfo.dotColor} shrink-0`} />
        <div className="min-w-0">
          <div className="font-semibold text-white text-xs truncate">{statusInfo.title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {statusDescription || statusInfo.subtitle}
          </div>
        </div>
      </div>
    </div>
  )
})
