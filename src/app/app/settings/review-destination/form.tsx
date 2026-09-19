'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  confirmDestination,
  saveDestination,
  type DestinationResult,
} from '@/actions/destinations'
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
  const router = useRouter()

  const [selectedLocationId, setSelectedLocationId] = useState(
    locations[0]?.id || ''
  )
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [tested, setTested] = useState(false)
  const [result, setResult] = useState<DestinationResult | null>(null)

  const activeDestination = destinations.find(
    (destination) => destination.location_id === selectedLocationId
  )

  const testUrl =
    inputUrl.trim() || activeDestination?.canonical_url || ''

  function handleTestUrl() {
    const validation = validateGoogleReviewUrl(testUrl)

    if (!validation.valid || !validation.canonicalUrl) {
      setTested(false)
      setResult({
        success: false,
        error:
          validation.error ||
          'Please enter or save a valid HTTPS Google review link',
      })
      return
    }

    window.open(
      validation.canonicalUrl,
      '_blank',
      'noopener,noreferrer'
    )

    setTested(true)
    setResult({
      success: true,
      canonicalUrl: validation.canonicalUrl,
      status:
        activeDestination?.status === 'CONFIRMED'
          ? 'CONFIRMED'
          : 'PENDING_CONFIRMATION',
    })
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setResult(null)
    setTested(false)

    const formData = new FormData(event.currentTarget)

    try {
      const response = await saveDestination(formData)
      setResult(response)

      if (response.success) {
        setInputUrl('')
        router.refresh()
      }
    } catch {
      setResult({
        success: false,
        error: 'Unexpected error occurred while saving destination.',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!tested) {
      setResult({
        success: false,
        error:
          'Test the saved Google review destination before confirming it.',
      })
      return
    }

    setConfirming(true)
    setResult(null)

    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('locationId', selectedLocationId)
    formData.set('explicitlyTested', 'true')

    try {
      const response = await confirmDestination(formData)
      setResult(response)

      if (response.success) {
        router.refresh()
      }
    } catch {
      setResult({
        success: false,
        error: 'Unexpected error occurred while confirming destination.',
      })
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      {result && (
        <div
          role="status"
          className={`p-4 rounded-md border text-sm flex items-start gap-3 ${
            result.success
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800 text-rose-200'
          }`}
        >
          <div>
            <strong className="font-semibold">
              {result.success ? 'Saved: ' : 'Error: '}
            </strong>
            {result.success
              ? result.status === 'CONFIRMED'
                ? 'Google review destination is confirmed and eligible for automation.'
                : 'Destination saved. Test the link, then explicitly confirm it before automation can use it.'
              : result.error}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="space-y-6 bg-slate-900 border border-slate-800 p-6 rounded-lg"
      >
        <input
          type="hidden"
          name="organizationId"
          value={organizationId}
        />

        <div>
          <label
            htmlFor="locationId"
            className="block text-sm font-medium text-slate-300"
          >
            Select Location
          </label>

          <select
            id="locationId"
            name="locationId"
            value={selectedLocationId}
            onChange={(event) => {
              setSelectedLocationId(event.target.value)
              setInputUrl('')
              setTested(false)
              setResult(null)
            }}
            className="mt-1 block w-full pl-3 pr-10 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>

        {activeDestination ? (
          <div className="bg-slate-950 border border-slate-800 p-4 rounded-md text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">
                Configured Destination:
              </span>

              <span
                className={`border px-2 py-0.5 rounded uppercase font-semibold ${
                  activeDestination.status === 'CONFIRMED'
                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}
              >
                {activeDestination.status}
              </span>
            </div>

            <div className="font-mono text-slate-300 break-all">
              {activeDestination.canonical_url}
            </div>

            <div className="text-slate-500">
              {activeDestination.status === 'CONFIRMED'
                ? `Confirmed on: ${
                    activeDestination.confirmed_at
                      ? new Date(
                          activeDestination.confirmed_at
                        ).toLocaleString()
                      : 'Unknown'
                  }`
                : 'Saved but not active. Test the link and explicitly confirm it.'}
            </div>
          </div>
        ) : (
          <div className="bg-amber-950/30 border border-amber-900/40 p-4 rounded-md text-xs text-amber-300">
            No Google review destination has been saved for this location.
          </div>
        )}

        <div>
          <label
            htmlFor="url"
            className="block text-sm font-medium text-slate-300"
          >
            Google Review URL
            <span className="text-rose-400"> *</span>
          </label>

          <input
            id="url"
            name="url"
            type="url"
            required
            placeholder="https://g.page/r/your-place-id/review"
            value={inputUrl}
            onChange={(event) => {
              setInputUrl(event.target.value)
              setTested(false)
            }}
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm font-mono text-xs"
          />

          <p className="mt-1 text-xs text-slate-500">
            Saving a URL does not activate it. Every changed destination must
            be tested and explicitly confirmed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save Destination'}
          </button>

          <button
            type="button"
            onClick={handleTestUrl}
            className="inline-flex justify-center py-2 px-4 border border-slate-700 rounded-md text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700"
          >
            Test Link ↗
          </button>
        </div>

        {activeDestination &&
          activeDestination.status !== 'CONFIRMED' && (
            <div className="border-t border-slate-800 pt-5 space-y-3">
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={tested}
                  onChange={(event) =>
                    setTested(event.target.checked)
                  }
                  className="mt-1"
                />

                <span>
                  I tested this saved link and confirmed that it opens the
                  correct Google review destination for this location.
                </span>
              </label>

              <button
                type="button"
                disabled={!tested || confirming}
                onClick={handleConfirm}
                className="inline-flex justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {confirming
                  ? 'Confirming…'
                  : 'Confirm Tested Destination'}
              </button>
            </div>
          )}
      </form>
    </div>
  )
}
