'use client'

import { useState } from 'react'
import { submitQuickComplete, QuickCompleteResult } from '@/actions/quick-complete'

interface LocationItem {
  id: string
  name: string
}

export function QuickCompleteForm({
  organizationId,
  locations,
}: {
  organizationId: string
  locations: LocationItem[]
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QuickCompleteResult | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    const formData = new FormData(e.currentTarget)
    try {
      const res = await submitQuickComplete(formData)
      setResult(res)
      if (res.success && !res.duplicate) {
        // Reset form inputs except organizationId and locationId
        const form = e.target as HTMLFormElement
        form.reset()
      }
    } catch {
      setResult({ success: false, error: 'An unexpected error occurred while submitting.' })
    } finally {
      setLoading(false)
    }
  }

  if (locations.length === 0) {
    return (
      <div className="bg-amber-950/40 border border-amber-800 p-6 rounded-lg text-amber-200 text-sm">
        No locations found. Please create at least one location before recording customer completions.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="organizationId" value={organizationId} />

      {result && (
        <div
          className={`p-4 rounded-md border text-sm ${
            result.success
              ? result.duplicate
                ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                : 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800 text-rose-200'
          }`}
        >
          {result.success ? (
            <div>
              <strong className="font-semibold">
                {result.duplicate ? 'Duplicate Handled: ' : 'Success: '}
              </strong>
              {result.message}
            </div>
          ) : (
            <div>
              <strong className="font-semibold">Error: </strong>
              {result.error}
            </div>
          )}
        </div>
      )}

      {/* Location */}
      <div>
        <label htmlFor="locationId" className="block text-sm font-medium text-slate-300">
          Location
        </label>
        <select
          id="locationId"
          name="locationId"
          required
          defaultValue={locations[0]?.id}
          className="mt-1 block w-full pl-3 pr-10 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      {/* First & Last Name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-slate-300">
            Customer First Name <span className="text-rose-400">*</span>
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            placeholder="Jane"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-slate-300">
            Customer Last Name (optional)
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            placeholder="Doe"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Email & Phone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-300">
            Email Address <span className="text-rose-400">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="customer@example.test"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-slate-300">
            Phone Number (optional)
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            placeholder="416-555-0199"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Completion Time */}
      <div>
        <label htmlFor="completedAt" className="block text-sm font-medium text-slate-300">
          Completion Date / Time (UTC or local)
        </label>
        <input
          id="completedAt"
          name="completedAt"
          type="datetime-local"
          defaultValue={new Date().toISOString().slice(0, 16)}
          className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Defaults to current time. Idempotency is enforced on identical completion events.
        </p>
      </div>

      {/* Submit */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
        >
          {loading ? 'Recording Completion...' : 'Complete Customer'}
        </button>
      </div>
    </form>
  )
}
