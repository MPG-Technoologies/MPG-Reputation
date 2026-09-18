'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QuickCompleteResult | null>(null)
  // Prompt Correction 8: Stable idempotency key across double-clicks and retries; fresh key after reset
  const [sourceEventId, setSourceEventId] = useState(() => `qc_${crypto.randomUUID()}`)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    const formData = new FormData(e.currentTarget)
    try {
      const res = await submitQuickComplete(formData)
      setResult(res)
      if (res.success && !res.duplicate) {
        const form = e.target as HTMLFormElement
        form.reset()
        // Generate new key for the next legitimate job completion
        setSourceEventId(`qc_${crypto.randomUUID()}`)
        router.refresh()
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
      <input type="hidden" name="sourceEventId" value={sourceEventId} />

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
            First Name <span className="text-rose-400">*</span>
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            placeholder="Jane"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-slate-300">
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            placeholder="Doe"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Contact info: Email and Phone */}
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
            placeholder="jane.doe@example.test"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-slate-300">
            Phone Number <span className="text-slate-500 text-xs">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            placeholder="+1 (555) 000-0000"
            className="mt-1 block w-full px-3 py-2 border border-slate-700 bg-slate-800 text-slate-100 rounded-md shadow-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Explicit Email Permission Selector (Prompt Correction 1) */}
      <div>
        <label className="block text-sm font-medium text-slate-300">
          Email Permission
        </label>
        <p className="text-xs text-slate-400 mt-0.5 mb-2">
          Conservative default is Unknown. Review solicitation requires explicit Allowed permission.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex items-center gap-2 p-2.5 rounded border border-slate-700 bg-slate-800 text-xs text-slate-200 cursor-pointer hover:bg-slate-700">
            <input type="radio" name="permissionEmail" value="unknown" defaultChecked />
            <span>Unknown (Default)</span>
          </label>
          <label className="flex items-center gap-2 p-2.5 rounded border border-slate-700 bg-slate-800 text-xs text-slate-200 cursor-pointer hover:bg-slate-700">
            <input type="radio" name="permissionEmail" value="allowed" />
            <span>Allowed</span>
          </label>
          <label className="flex items-center gap-2 p-2.5 rounded border border-slate-700 bg-slate-800 text-xs text-slate-200 cursor-pointer hover:bg-slate-700">
            <input type="radio" name="permissionEmail" value="denied" />
            <span>Denied</span>
          </label>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Recording...' : 'Record Completion & Trigger'}
        </button>
      </div>
    </form>
  )
}
