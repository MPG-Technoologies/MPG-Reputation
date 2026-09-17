'use client'

import { useState } from 'react'
import { saveAndConfirmDestination, DestinationResult } from '@/actions/destinations'
import { validateGoogleReviewUrl } from '@/domain/destination'

interface LocationItem {
  id: string
  name: string
}

interface DestinationItem {
  id: string
  location_id: string
  url: string
  canonical_url: string
  status: string
  confirmed_at: string | null
}

export function DestinationForm({
  organizationId,
  locations,
  destinations,
}: {
  organizationId: string
  locations: LocationItem[]
  destinations: DestinationItem[]
}) {
  const [selectedLocationId, setSelectedLocationId] = useState(locations[0]?.id || '')
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DestinationResult | null>(null)

  const activeDestination = destinations.find((d) => d.location_id === selectedLocationId)

  function handleTestUrl() {
    const check = validateGoogleReviewUrl(inputUrl || activeDestination?.canonical_url || '')
    if (check.valid && check.canonicalUrl) {
      window.open(check.canonicalUrl, '_blank', 'noopener,noreferrer')
    } else {
      alert(`Invalid Google review URL: ${check.error || 'Please enter a valid HTTPS Google review link'}`)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    const formData = new FormData(e.currentTarget)
    try {
      const res = await saveAndConfirmDestination(formData)
      setResult(res)
    } catch {
      setResult({ success: false, error: 'Unexpected error occurred while saving destination.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {result && (
        <div
          className={`p-4 rounded-md border text-sm ${
            result.success
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800 text-rose-200'
          }`}
        >
          {result.success ? (
            <div>
              <strong className="font-semibold">Confirmed: </strong>
              Google review destination URL successfully validated and confirmed.
            </div>
          ) : (
            <div>
              <strong className="font-semibold">Validation Error: </strong>
              {result.error}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 bg-slate-900 border border-slate-800 p-6 rounded-lg">
        <input type="hidden" name="organizationId" value={organizationId} />

        {/* Location selector */}
        <div>
          <label htmlFor="locationId" className="block text-sm font-medium text-slate-300">
            Select Location
          </label>
          <select
            id="locationId"
            name="locationId"
            value={selectedLocationId}
            onChange={(e) => {
              setSelectedLocationId(e.target.value)
              setInputUrl('')
              setResult(null)
            }}
            className="mt-1 block w-full pl-3 pr-10 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Current status display */}
        {activeDestination ? (
          <div className="bg-slate-950 border border-slate-800 p-4 rounded-md text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Configured Destination:</span>
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded uppercase font-semibold">
                {activeDestination.status}
              </span>
            </div>
            <div className="font-mono text-slate-300 break-all">{activeDestination.canonical_url}</div>
            <div className="text-slate-500">
              Confirmed on: {activeDestination.confirmed_at ? new Date(activeDestination.confirmed_at).toLocaleString() : 'Pending'}
            </div>
          </div>
        ) : (
          <div className="bg-amber-950/30 border border-amber-900/40 p-4 rounded-md text-xs text-amber-300">
            No Google review destination confirmed yet for this location.
          </div>
        )}

        {/* Google Review Destination URL */}
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-slate-300">
            Google Review URL <span className="text-rose-400">*</span>
          </label>
          <input
            id="url"
            name="url"
            type="url"
            required
            placeholder="https://g.page/r/your-place-id/review"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm font-mono text-xs"
          />
          <p className="mt-1 text-xs text-slate-500">
            Must be a secure HTTPS Google URL (e.g. <code>https://g.page/r/.../review</code> or <code>https://search.google.com/local/writereview?placeid=...</code>).
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
          >
            {loading ? 'Validating...' : 'Validate & Confirm Destination'}
          </button>

          <button
            type="button"
            onClick={handleTestUrl}
            className="inline-flex justify-center py-2 px-4 border border-slate-700 rounded-md shadow-sm text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 focus:outline-none transition-colors"
          >
            Test Link ↗
          </button>
        </div>
      </form>
    </div>
  )
}
