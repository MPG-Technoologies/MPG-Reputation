'use client'

import React from 'react'
import type { DashboardKpis as KpiData } from '@/lib/dashboard/realtime-types'

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
  }> = [
    {
      key: 'completedCount',
      label: 'Completed Customers',
      value: kpis.completedCount,
      subtitle: 'Quick Complete jobs',
    },
    {
      key: 'eligibleCount',
      label: 'Eligible Requests',
      value: kpis.eligibleCount,
      subtitle: 'Passed consent & rules',
    },
    {
      key: 'scheduledCount',
      label: 'Requests Scheduled',
      value: kpis.scheduledCount,
      subtitle: 'Awaiting cooldown delay',
    },
    {
      key: 'sentCount',
      label: 'Invitations Sent',
      value: kpis.sentCount,
      subtitle: 'Email dispatches',
    },
    {
      key: 'clickedCount',
      label: 'Feedback Link Clicks',
      value: kpis.clickedCount,
      subtitle: 'Tracked link visits',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {cards.map((card) => {
        const isHighlighted = highlightedKey === card.key
        return (
          <div
            key={card.key}
            className={`border p-5 rounded-lg transition-all duration-500 motion-reduce:transition-none ${
              isHighlighted
                ? 'bg-slate-800/90 border-blue-500/80 ring-1 ring-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <span className="text-xs font-medium text-slate-400">{card.label}</span>
            <div
              className={`mt-2 text-2xl font-bold text-white transition-transform duration-300 motion-reduce:transition-none ${
                isHighlighted ? 'scale-105' : 'scale-100'
              }`}
            >
              {card.value}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">{card.subtitle}</span>
          </div>
        )
      })}
    </div>
  )
})
