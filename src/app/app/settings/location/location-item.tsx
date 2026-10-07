'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateLocationSettings } from '@/actions/locations'

export interface LocationItemData {
  id: string
  name: string
  address: string | null
  country: string
  timezone: string
  status: string
  review_reply_to_email: string | null
}

export function LocationItem({
  organizationId,
  location,
  canManage,
}: {
  organizationId: string
  location: LocationItemData
  canManage: boolean
}) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      const formData = new FormData(e.currentTarget)
      const result = await updateLocationSettings(formData)
      if (result.success) {
        setIsEditing(false)
        router.refresh()
      } else {
        setError(result.error || 'Failed to update location settings')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update location settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-5 hover:bg-[#131E38]/40 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white text-sm">{location.name}</h3>
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                location.status === 'ACTIVE'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {location.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {location.address || 'No business mailing address configured'}
          </p>
          {location.review_reply_to_email && (
            <p className="text-xs text-sky-400 mt-1 font-mono">
              Reply-To: {location.review_reply_to_email}
            </p>
          )}
          <span className="text-[11px] text-slate-500 mt-1.5 block">
            {location.country} • {location.timezone}
          </span>
        </div>

        {canManage && !isEditing && (
          <button
            type="button"
            onClick={() => {
              setIsEditing(true)
              setError(null)
            }}
            className="self-start sm:self-center px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-md transition-colors shrink-0"
          >
            Edit
          </button>
        )}
      </div>

      {canManage && isEditing && (
        <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-[#1C2846]/70 space-y-3 text-xs">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="locationId" value={location.id} />

          {error && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-md text-xs text-rose-300">
              {error}
            </div>
          )}

          <div>
            <label htmlFor={`name-${location.id}`} className="block font-medium text-slate-300">
              Location Name <span className="text-rose-400">*</span>
            </label>
            <input
              id={`name-${location.id}`}
              name="name"
              type="text"
              required
              defaultValue={location.name}
              placeholder="e.g. West End Branch"
              className="mt-1 block w-full px-3 py-2 bg-[#0A1020] border border-[#1C2846] text-white rounded-lg placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xs"
            />
          </div>

          <div>
            <label htmlFor={`address-${location.id}`} className="block font-medium text-slate-300">
              Business Mailing Address
            </label>
            <input
              id={`address-${location.id}`}
              name="address"
              type="text"
              maxLength={300}
              defaultValue={location.address || ''}
              placeholder="123 Example Street, Suite 100, City, ST 12345"
              className="mt-1 block w-full px-3 py-2 bg-[#0A1020] border border-[#1C2846] text-white rounded-lg placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Used in review-request email footers. Enter the complete business mailing address for this location. Required before live review emails can be sent.
            </p>
          </div>

          <div>
            <label htmlFor={`replyTo-${location.id}`} className="block font-medium text-slate-300">
              Review Request Reply-To Email{' '}
              <span className="text-slate-500 font-normal">(Optional)</span>
            </label>
            <input
              id={`replyTo-${location.id}`}
              name="reviewReplyToEmail"
              type="email"
              defaultValue={location.review_reply_to_email || ''}
              placeholder="reviews@business.com"
              className="mt-1 block w-full px-3 py-2 bg-[#0A1020] border border-[#1C2846] text-white rounded-lg placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xs font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Customer email replies will be directed here. If omitted, no Reply-To header is set.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg text-xs transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false)
                setError(null)
              }}
              disabled={isSaving}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
