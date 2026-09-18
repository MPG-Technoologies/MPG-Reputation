'use client'

import React from 'react'
import Link from 'next/link'
import type { AttentionItem } from '@/lib/dashboard/realtime-types'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  CheckCircleIcon,
} from '@/components/ui/icons'

interface NeedsAttentionCardProps {
  items: AttentionItem[]
}

export const NeedsAttentionCard = React.memo(function NeedsAttentionCard({
  items,
}: NeedsAttentionCardProps) {
  const hasErrors = items.some((i) => i.severity === 'error')
  const hasWarnings = items.some((i) => i.severity === 'warning')

  if (!items || items.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Needs Attention</h2>
          <span className="text-[11px] text-slate-500">0 conditions</span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>No operational issues detected.</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`bg-slate-900 border rounded-lg overflow-hidden transition-colors ${
        hasErrors
          ? 'border-rose-900/60'
          : hasWarnings
          ? 'border-amber-900/60'
          : 'border-slate-800'
      }`}
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Needs Attention</h2>
          {hasErrors ? (
            <AlertCircleIcon className="w-3.5 h-3.5 text-rose-400" />
          ) : hasWarnings ? (
            <AlertTriangleIcon className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <InfoIcon className="w-3.5 h-3.5 text-blue-400" />
          )}
        </div>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded ${
            hasErrors
              ? 'bg-rose-950/60 text-rose-300 border border-rose-800/80'
              : hasWarnings
              ? 'bg-amber-950/60 text-amber-300 border border-amber-800/80'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
        >
          {`${items.length} ${items.length === 1 ? 'condition' : 'conditions'}`}
        </span>
      </div>

      {/* Stacked Items */}
      <div className="p-4 space-y-3">
        {items.map((item) => {
          const isError = item.severity === 'error'
          const isWarning = item.severity === 'warning'

          return (
            <div
              key={item.id}
              className={`p-3 rounded-md border text-xs flex flex-col justify-between transition-colors ${
                isError
                  ? 'bg-rose-950/30 border-rose-800/60 text-rose-200'
                  : isWarning
                  ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                  : 'bg-slate-800/50 border-slate-700/60 text-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
                  {isError && <span className="text-rose-400">●</span>}
                  {isWarning && <span className="text-amber-400">●</span>}
                  {!isError && !isWarning && <span className="text-blue-400">●</span>}
                  <span>{item.title}</span>
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">{item.description}</p>
              </div>

              {item.actionHref && item.actionLabel && (
                <div className="mt-2.5 pt-2 border-t border-slate-700/40">
                  <Link
                    href={item.actionHref}
                    className="text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1"
                  >
                    <span>{item.actionLabel}</span>
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
