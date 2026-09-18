import React from 'react'
import type { DashboardKpis as KpiData } from '@/lib/dashboard/realtime-types'
import {
  UsersCheckIcon,
  EnvelopeCheckIcon,
  ClockIcon,
  PaperPlaneIcon,
  LinkIcon,
} from '@/components/ui/icons'

interface DashboardKpisProps {
  kpis: KpiData
  highlightedKey: keyof KpiData | null
}

export const DashboardKpis = React.memo(function DashboardKpis({
  kpis,
  highlightedKey,
}: DashboardKpisProps) {
  const cards: Array<{
    key: keyof KpiData
    label: string
    value: number
    subtitle: string
    icon: React.ComponentType<{ className?: string }>
    accentColor: string
  }> = [
    {
      key: 'completedCount',
      label: 'Completed Customers',
      value: kpis.completedCount,
      subtitle: 'Quick Complete jobs',
      icon: UsersCheckIcon,
      accentColor: 'text-blue-400 bg-blue-950/40 border-blue-800/50',
    },
    {
      key: 'eligibleCount',
      label: 'Eligible Requests',
      value: kpis.eligibleCount,
      subtitle: 'Passed consent & rules',
      icon: EnvelopeCheckIcon,
      accentColor: 'text-indigo-400 bg-indigo-950/40 border-indigo-800/50',
    },
    {
      key: 'scheduledCount',
      label: 'Requests Scheduled',
      value: kpis.scheduledCount,
      subtitle: 'Awaiting cooldown delay',
      icon: ClockIcon,
      accentColor: 'text-amber-400 bg-amber-950/40 border-amber-800/50',
    },
    {
      key: 'sentCount',
      label: 'Invitations Sent',
      value: kpis.sentCount,
      subtitle: 'Email dispatches',
      icon: PaperPlaneIcon,
      accentColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50',
    },
    {
      key: 'clickedCount',
      label: 'Feedback Link Clicks',
      value: kpis.clickedCount,
      subtitle: 'Tracked link visits',
      icon: LinkIcon,
      accentColor: 'text-sky-400 bg-sky-950/40 border-sky-800/50',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
      {cards.map((card) => {
        const isHighlighted = highlightedKey === card.key
        const IconComponent = card.icon

        return (
          <div
            key={card.key}
            className={`border p-4 sm:p-5 rounded-lg transition-all duration-500 motion-reduce:transition-none flex flex-col justify-between ${
              isHighlighted
                ? 'bg-slate-800/90 border-blue-500/80 ring-1 ring-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                : 'bg-slate-900/90 border-slate-800 hover:border-slate-700/80'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-slate-400 leading-tight">
                {card.label}
              </span>
              <div
                className={`p-1.5 rounded-md border shrink-0 ${card.accentColor}`}
                aria-hidden="true"
              >
                <IconComponent className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
            </div>

            <div className="mt-3 sm:mt-4">
              <div
                className={`text-2xl sm:text-3xl font-bold text-white tracking-tight transition-transform duration-300 motion-reduce:transition-none ${
                  isHighlighted ? 'scale-105 origin-left' : 'scale-100'
                }`}
              >
                {card.value}
              </div>
              <span className="text-[11px] sm:text-xs text-slate-500 mt-1 block leading-snug">
                {card.subtitle}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
})
