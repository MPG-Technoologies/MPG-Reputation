'use client'

import Link from 'next/link'
import type { QuickCompleteResult } from '@/actions/quick-complete'

interface QuickCompleteReceiptProps {
  result: QuickCompleteResult
  onDone?: () => void
}

/**
 * Recording a completed service is not proof that a review request was
 * eligible, sent, delivered, or that the end customer posted a review.
 */
export function QuickCompleteReceipt({ result, onDone }: QuickCompleteReceiptProps) {
  const recorded = result.success && !result.duplicate
  const duplicate = result.success && result.duplicate

  return (
    <div
      role={result.success ? 'status' : 'alert'}
      aria-live={result.success ? 'polite' : 'assertive'}
      className={`p-4 rounded-md border text-sm animate-page-enter space-y-3 ${
        recorded
          ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
          : duplicate
            ? 'bg-amber-950/40 border-amber-800 text-amber-200'
            : 'bg-rose-950/40 border-rose-800 text-rose-200'
      }`}
    >
      <div className="font-semibold">
        {recorded
          ? 'Completion recorded'
          : duplicate
            ? 'Already recorded'
            : 'Could not record completion'}
      </div>
      <p>{result.success ? result.message : result.error}</p>
      {recorded && (
        <div className="space-y-1 text-xs leading-relaxed">
          <p><strong>Completed service:</strong> Recorded</p>
          <p><strong>Review request:</strong> Check Recent Activity for its eligibility and outcome</p>
          <p><strong>Email delivery:</strong> Not confirmed by this receipt</p>
        </div>
      )}
      {duplicate && (
        <p className="text-xs leading-relaxed">
          No second completion was created by this submission.
        </p>
      )}
      {result.success && (
        <div className="flex flex-wrap gap-3 items-center pt-1">
          <Link
            href="/app/dashboard"
            onClick={onDone}
            className="text-xs font-semibold underline underline-offset-4 hover:text-white"
          >
            View Recent Activity
          </Link>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg bg-[#131E38] border border-[#334166] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1D2E52]"
            >
              Done
            </button>
          )}
        </div>
      )}
    </div>
  )
}
