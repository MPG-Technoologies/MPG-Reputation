'use client'

import React from 'react'
import type { LiveActivityItem, LiveActivityStage } from '@/lib/dashboard/realtime-types'

interface LiveActivityProps {
  activities: LiveActivityItem[]
}

const STATUS_COPY: Record<LiveActivityStage, string> = {
  RECEIVED: 'Completion received',
  CHECKING: 'Checking eligibility and safeguards',
  PREPARING: 'Preparing review invitation',
  SENT: 'Invitation sent',
  BYPASSED: 'No request sent — policy rules applied',
  FAILED: 'Dispatch needs attention',
}

const STAGE_BADGE_STYLES: Record<LiveActivityStage, string> = {
  RECEIVED: 'bg-slate-800 text-slate-300 border-slate-700',
  CHECKING: 'bg-amber-950/60 text-amber-300 border-amber-800/80',
  PREPARING: 'bg-blue-950/60 text-blue-300 border-blue-800/80',
  SENT: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80 transition-colors duration-300 motion-reduce:transition-none',
  BYPASSED: 'bg-slate-800/80 text-slate-400 border-slate-700',
  FAILED: 'bg-rose-950/60 text-rose-300 border-rose-800/80',
}

export const LiveActivity = React.memo(function LiveActivity({
  activities,
}: LiveActivityProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Live Activity</h2>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse motion-reduce:animate-none" />
              Realtime Workflow
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Realtime workflow progress for newly completed customers.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {activities.length > 0 ? `${activities.length} in this session` : 'Session monitor'}
        </span>
      </div>

      {!activities || activities.length === 0 ? (
        <div className="p-6 text-center text-slate-500 text-sm">
          No live workflow activity recorded in this session.
          <div className="mt-1 text-xs text-slate-400">
            Submit a customer via Quick Complete to watch stage-by-stage progression in realtime.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {activities.map((act) => {
            const copy = STATUS_COPY[act.stage]
            const badgeStyle = STAGE_BADGE_STYLES[act.stage]

            return (
              <div
                key={act.completionEventId}
                className="p-5 hover:bg-slate-800/30 transition-colors duration-300 motion-reduce:transition-none"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left Column: Customer & Status copy */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-white text-base truncate">
                        {act.customerName}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${badgeStyle}`}
                      >
                        {act.stage}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                      <span
                        key={act.stage}
                        className="text-slate-300 inline-block animate-status-crossfade motion-reduce:animate-none"
                      >
                        {copy}
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className="text-slate-500">
                        {new Date(act.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Visual Progress Rail */}
                  <div className="shrink-0">
                    <ProgressRail stage={act.stage} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

interface ProgressRailProps {
  stage: LiveActivityStage
}

function RailConnector({ isFilled }: { isFilled: boolean }) {
  return (
    <div className="w-4 sm:w-6 h-[2px] bg-slate-800 rounded-full overflow-hidden shrink-0 mx-0.5 sm:mx-1">
      <div
        className={`h-full bg-emerald-500 transition-all duration-400 ease-out motion-reduce:transition-none ${
          isFilled ? 'w-full' : 'w-0'
        }`}
      />
    </div>
  )
}

function ProgressRail({ stage }: ProgressRailProps) {
  if (stage === 'BYPASSED') {
    return (
      <div className="flex items-center gap-1 sm:gap-1.5 text-xs font-medium">
        <span className="flex items-center gap-1.5 text-slate-200">
          <span className="w-4 h-4 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 flex items-center justify-center text-[10px] font-bold animate-checkmark-in motion-reduce:animate-none">
            ✓
          </span>
          <span>Received</span>
        </span>
        <RailConnector isFilled={true} />
        <span className="flex items-center gap-1.5 text-slate-200">
          <span className="w-4 h-4 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 flex items-center justify-center text-[10px] font-bold animate-checkmark-in motion-reduce:animate-none">
            ✓
          </span>
          <span>Checking</span>
        </span>
        <RailConnector isFilled={true} />
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          BYPASSED
        </span>
      </div>
    )
  }

  if (stage === 'FAILED') {
    return (
      <div className="flex items-center gap-1 sm:gap-1.5 text-xs font-medium">
        <span className="flex items-center gap-1.5 text-slate-200">
          <span className="w-4 h-4 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 flex items-center justify-center text-[10px] font-bold animate-checkmark-in motion-reduce:animate-none">
            ✓
          </span>
          <span>Received</span>
        </span>
        <RailConnector isFilled={true} />
        <span className="flex items-center gap-1.5 text-slate-200">
          <span className="w-4 h-4 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 flex items-center justify-center text-[10px] font-bold animate-checkmark-in motion-reduce:animate-none">
            ✓
          </span>
          <span>Checking</span>
        </span>
        <RailConnector isFilled={true} />
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
          FAILED
        </span>
      </div>
    )
  }

  // Normal 4-stage rail: Received -> Checking -> Preparing -> Sent
  const stages: { key: LiveActivityStage; label: string }[] = [
    { key: 'RECEIVED', label: 'Received' },
    { key: 'CHECKING', label: 'Checking' },
    { key: 'PREPARING', label: 'Preparing' },
    { key: 'SENT', label: 'Sent' },
  ]

  const stageIndices: Record<LiveActivityStage, number> = {
    RECEIVED: 0,
    CHECKING: 1,
    PREPARING: 2,
    SENT: 3,
    BYPASSED: 1,
    FAILED: 2,
  }

  const activeIndex = stageIndices[stage]

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 text-xs font-medium">
      {stages.map((st, idx) => {
        const isCompleted = idx < activeIndex || (stage === 'SENT' && idx === 3)
        const isCurrent = idx === activeIndex && stage !== 'SENT'
        const isConnectorFilled = idx <= activeIndex || stage === 'SENT'

        return (
          <React.Fragment key={st.key}>
            {idx > 0 && <RailConnector isFilled={isConnectorFilled} />}
            <span
              className={`flex items-center gap-1.5 transition-colors duration-300 motion-reduce:transition-none ${
                isCompleted
                  ? 'text-slate-200'
                  : isCurrent
                  ? 'text-white'
                  : 'text-slate-600'
              }`}
            >
              {isCompleted ? (
                <span className="w-4 h-4 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-400 flex items-center justify-center text-[10px] font-bold animate-checkmark-in motion-reduce:animate-none">
                  ✓
                </span>
              ) : isCurrent ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400 motion-safe:animate-pulse motion-reduce:animate-none" />
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-700" />
              )}
              <span className={isCurrent ? 'font-semibold' : ''}>{st.label}</span>
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}
