'use client'

import React from 'react'
import Link from 'next/link'
import { useModal } from '@/components/ui/modal-system'
import { CheckCircleIcon } from '@/components/ui/icons'

export function DestinationReadyBanner() {
  const { openQuickComplete } = useModal()

  return (
    <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex items-start gap-3">
        <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-emerald-200">
            Customer activation setup complete
          </div>
          <p className="text-xs text-emerald-300/70 mt-1 leading-relaxed">
            Active locations have tested and confirmed Google review destinations. Quick Complete is ready to record customer completions.
          </p>
        </div>
      </div>

      <Link
        href="/app/quick-complete"
        onClick={(e) => {
          e.preventDefault()
          openQuickComplete()
        }}
        className="inline-flex shrink-0 items-center justify-center py-2 px-4 rounded-lg text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm shadow-emerald-900/30 transition-colors"
      >
        Open Quick Complete →
      </Link>
    </div>
  )
}
