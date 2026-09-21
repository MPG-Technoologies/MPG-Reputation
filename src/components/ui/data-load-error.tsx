'use client'

import React from 'react'

export function DataLoadError({ title }: { title: string }) {
  return (
    <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/30 p-5 text-sm text-amber-100">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-xs text-amber-200">Please reload the page to try again.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 rounded-lg border border-amber-700 px-3 py-2 text-xs font-medium hover:bg-amber-900/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        Reload page
      </button>
    </div>
  )
}
