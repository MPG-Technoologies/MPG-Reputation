import React from 'react'
import type { DashboardKpis as KpiData } from '@/lib/dashboard/realtime-types'
import {
  UsersIcon,
  DocumentIcon,
  CalendarIcon,
  PaperPlaneIcon,
  LinkIcon,
  ChevronRightIcon,
} from '@/components/ui/icons'

interface DashboardKpisProps {
  kpis: KpiData
  highlightedKey: keyof KpiData | null
}

interface SparklineProps {
  color: string
  trend: 'up' | 'down' | 'neutral'
}

function Sparkline({ color, trend }: SparklineProps) {
  const d =
    trend === 'up'
      ? 'M 0,18 Q 15,14 30,16 T 60,6 T 90,2'
      : trend === 'down'
      ? 'M 0,2 Q 15,6 30,10 T 60,14 T 90,18'
      : 'M 0,10 L 90,10'

  return (
    <svg
      className="w-full max-w-[64px] sm:max-w-[72px] h-4 overflow-visible shrink"
      viewBox="0 0 90 20"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        d={d}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const DashboardKpis = React.memo(function DashboardKpis({
  kpis,
  highlightedKey,
}: DashboardKpisProps) {
  const cards: Array<{
    key: keyof KpiData
    label: string
    mobileLabel: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    badgeStyle: string
    iconColor: string
    sparklineColor: string
  }> = [
    {
      key: 'completedCount',
      label: 'Completed Customers',
      mobileLabel: 'Completed',
      value: kpis.completedCount,
      icon: UsersIcon,
      badgeStyle: 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400',
      iconColor: '#10B981',
      sparklineColor: '#10B981',
    },
    {
      key: 'eligibleCount',
      label: 'Eligible Requests',
      mobileLabel: 'Eligible',
      value: kpis.eligibleCount,
      icon: DocumentIcon,
      badgeStyle: 'bg-blue-950/60 border-blue-800/60 text-blue-400',
      iconColor: '#3B82F6',
      sparklineColor: '#3B82F6',
    },
    {
      key: 'scheduledCount',
      label: 'Requests Scheduled',
      mobileLabel: 'Scheduled',
      value: kpis.scheduledCount,
      icon: CalendarIcon,
      badgeStyle: 'bg-purple-950/60 border-purple-800/60 text-purple-400',
      iconColor: '#A855F7',
      sparklineColor: '#64748B',
    },
    {
      key: 'sentCount',
      label: 'Invitations Sent',
      mobileLabel: 'Sent',
      value: kpis.sentCount,
      icon: PaperPlaneIcon,
      badgeStyle: 'bg-sky-950/60 border-sky-800/60 text-sky-400',
      iconColor: '#0EA5E9',
      sparklineColor: '#0EA5E9',
    },
    {
      key: 'clickedCount',
      label: 'Feedback Link Clicks',
      mobileLabel: 'Clicks',
      value: kpis.clickedCount,
      icon: LinkIcon,
      badgeStyle: 'bg-teal-950/60 border-teal-800/60 text-teal-400',
      iconColor: '#14B8A6',
      sparklineColor: '#14B8A6',
    },
  ]

  // Reorder for mobile 2x2+1 grid: [Completed, Eligible], [Sent, Clicks], [Scheduled full width]
  const mobileRow1 = [cards[0], cards[1]]
  const mobileRow2 = [cards[3], cards[4]]
  const mobileRow3 = cards[2]

  return (
    <div>
      {/* ============================================================== */}
      {/* DESKTOP & TABLET: 5 KPI Cards in Row (>= 768px)                */}
      {/* ============================================================== */}
      <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-5 gap-3.5 xl:gap-4">
        {cards.map((card) => {
          const isHighlighted = highlightedKey === card.key
          const Icon = card.icon

          return (
            <div
              key={card.key}
              className={`p-4 xl:p-4.5 rounded-xl border transition-all duration-300 flex flex-col justify-between min-w-0 ${
                isHighlighted
                  ? 'bg-[#131E38] border-blue-500/80 ring-1 ring-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                  : 'bg-[#0E172B] border-[#1C2846] hover:border-[#2A3A62]'
              }`}
            >
              {/* Top Row: Icon Badge & Big Metric Value */}
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${card.badgeStyle}`}
                  aria-hidden="true"
                >
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <div className="text-2xl xl:text-3xl font-bold text-white tracking-tight truncate">
                  {card.value}
                </div>
              </div>

              {/* Middle: Metric Label */}
              <div className="mt-3.5 min-w-0">
                <div className="text-xs font-semibold text-slate-300 truncate">
                  {card.label}
                </div>
              </div>

              {/* Bottom: Sparkline without fabricated percentages */}
              <div className="mt-2.5 pt-2.5 border-t border-[#1C2846]/60 flex items-center justify-between gap-2 min-w-0">
                <div className="shrink min-w-0 max-w-[72px]">
                  <Sparkline color={card.sparklineColor} trend="neutral" />
                </div>
                <span className="text-[11px] font-medium text-slate-500 shrink-0 whitespace-nowrap">
                  All time
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ============================================================== */}
      {/* MOBILE: Approved 2x2 + 1 Grid (< 768px)                        */}
      {/* ============================================================== */}
      <div className="grid md:hidden grid-cols-2 gap-2.5">
        {/* Row 1: Completed & Eligible */}
        {mobileRow1.map((card) => {
          const isHighlighted = highlightedKey === card.key
          const Icon = card.icon
          return (
            <div
              key={card.key}
              className={`p-3.5 rounded-xl border flex items-center justify-between transition-colors ${
                isHighlighted
                  ? 'bg-[#131E38] border-blue-500/80'
                  : 'bg-[#0E172B] border-[#1C2846]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${card.badgeStyle}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-400 truncate">
                    {card.mobileLabel}
                  </div>
                  <div className="text-xl font-bold text-white">{card.value}</div>
                </div>
              </div>
              <ChevronRightIcon className="w-4 h-4 text-slate-500 shrink-0" />
            </div>
          )
        })}

        {/* Row 2: Sent & Clicks */}
        {mobileRow2.map((card) => {
          const isHighlighted = highlightedKey === card.key
          const Icon = card.icon
          return (
            <div
              key={card.key}
              className={`p-3.5 rounded-xl border flex items-center justify-between transition-colors ${
                isHighlighted
                  ? 'bg-[#131E38] border-blue-500/80'
                  : 'bg-[#0E172B] border-[#1C2846]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${card.badgeStyle}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-400 truncate">
                    {card.mobileLabel}
                  </div>
                  <div className="text-xl font-bold text-white">{card.value}</div>
                </div>
              </div>
              <ChevronRightIcon className="w-4 h-4 text-slate-500 shrink-0" />
            </div>
          )
        })}

        {/* Row 3: Scheduled (Full Width) */}
        <div
          className={`col-span-2 p-3.5 rounded-xl border flex items-center justify-between transition-colors ${
            highlightedKey === mobileRow3.key
              ? 'bg-[#131E38] border-blue-500/80'
              : 'bg-[#0E172B] border-[#1C2846]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${mobileRow3.badgeStyle}`}
            >
              <mobileRow3.icon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400">
                {mobileRow3.mobileLabel}
              </div>
              <div className="text-xl font-bold text-white">{mobileRow3.value}</div>
            </div>
          </div>
          <ChevronRightIcon className="w-4 h-4 text-slate-500 shrink-0" />
        </div>
      </div>
    </div>
  )
})
