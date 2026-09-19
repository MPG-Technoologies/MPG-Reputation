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
  onSuccess,
}: {
  organizationId: string
  locations: LocationItem[]
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QuickCompleteResult | null>(null)
  // Stable idempotency key across double-clicks and retries; fresh key after reset
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
        if (onSuccess) {
          setTimeout(() => {
            onSuccess()
          }, 1200)
        }
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
          role="status"
          className={`p-4 rounded-md border text-sm animate-page-enter flex items-start gap-3 ${
            result.success
              ? result.duplicate
                ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                : 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800 text-rose-200'
          }`}
        >
          {result.success ? (
            <>
              <svg
                className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <strong className="font-semibold">
                  {result.duplicate ? 'Duplicate Handled: ' : 'Success: '}
                </strong>
                {result.message}
              </div>
            </>
          ) : (
            <>
              <svg
                className="h-5 w-5 text-rose-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <div>
                <strong className="font-semibold">Error: </strong>
                {result.error}
              </div>
            </>
          )}
        </div>
      )}

      {/* Location */}
      <div>
        <label htmlFor="locationId" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
          Location
        </label>
        <select
          id="locationId"
          name="locationId"
          required
          defaultValue={locations[0]?.id}
          className="mt-1 block w-full px-3 py-2 border border-[#1C2846] bg-[#0A1020] text-slate-100 rounded-lg shadow-sm focus:outline-none focus:border-blue-500 text-xs"
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
          <label htmlFor="firstName" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            First Name <span className="text-rose-400">*</span>
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            placeholder="Jane"
            className="mt-1 block w-full px-3 py-2 border border-[#1C2846] bg-[#0A1020] text-slate-100 rounded-lg shadow-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            placeholder="Doe"
            className="mt-1 block w-full px-3 py-2 border border-[#1C2846] bg-[#0A1020] text-slate-100 rounded-lg shadow-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs"
          />
        </div>
      </div>

      {/* Contact info: Email and Phone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Email Address <span className="text-rose-400">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="jane.doe@example.test"
            className="mt-1 block w-full px-3 py-2 border border-[#1C2846] bg-[#0A1020] text-slate-100 rounded-lg shadow-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs font-mono"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Phone Number <span className="text-slate-500 font-normal lowercase">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            placeholder="+1 (555) 000-0000"
            className="mt-1 block w-full px-3 py-2 border border-[#1C2846] bg-[#0A1020] text-slate-100 rounded-lg shadow-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs font-mono"
          />
        </div>
      </div>

      {/* Explicit Email Permission Selector */}
      <div>
        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
          Email Permission
        </label>
        <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
          Conservative default is Unknown. Review solicitation requires explicit Allowed permission.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex items-center gap-2 p-2.5 rounded-lg border border-[#1C2846] bg-[#0A1020] text-xs text-slate-200 cursor-pointer hover:bg-[#131E38] transition-colors">
            <input type="radio" name="permissionEmail" value="unknown" defaultChecked />
            <span>Unknown (Default)</span>
          </label>
          <label className="flex items-center gap-2 p-2.5 rounded-lg border border-[#1C2846] bg-[#0A1020] text-xs text-slate-200 cursor-pointer hover:bg-[#131E38] transition-colors">
            <input type="radio" name="permissionEmail" value="allowed" />
            <span>Allowed</span>
          </label>
          <label className="flex items-center gap-2 p-2.5 rounded-lg border border-[#1C2846] bg-[#0A1020] text-xs text-slate-200 cursor-pointer hover:bg-[#131E38] transition-colors">
            <input type="radio" name="permissionEmail" value="denied" />
            <span>Denied</span>
          </label>
        </div>
      </div>

      <div className="pt-4 border-t border-[#1C2846] flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg shadow-sm shadow-blue-900/30 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Recording completion…</span>
            </>
          ) : (
            'Record Completion'
          )}
        </button>
      </div>
    </form>
  )
}
