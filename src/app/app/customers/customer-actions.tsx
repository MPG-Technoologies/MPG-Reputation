'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PlusCircleIcon,
  DocumentIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  XIcon,
} from '@/components/ui/icons'
import { useModal } from '@/components/ui/modal-system'

interface RecordCompletionButtonProps {
  label?: string
  className?: string
  variant?: 'primary' | 'secondary'
}

export function RecordCompletionButton({
  label = 'Record Completion',
  className = '',
  variant = 'primary',
}: RecordCompletionButtonProps) {
  const { openQuickComplete } = useModal()

  const baseStyles =
    variant === 'primary'
      ? 'bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-sm shadow-blue-900/30'
      : 'bg-[#131E38] hover:bg-[#192748] text-blue-400 font-medium border border-[#1C2846]'

  return (
    <Link
      href="/app/quick-complete"
      onClick={(e) => {
        e.preventDefault()
        openQuickComplete()
      }}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm rounded-lg transition-colors ${baseStyles} ${className}`}
    >
      <PlusCircleIcon className="w-4 h-4" />
      <span>{label}</span>
    </Link>
  )
}

interface CustomerPrivacyExportButtonProps {
  organizationId: string
  customerId: string
  className?: string
}

export function CustomerPrivacyExportButton({
  organizationId,
  customerId,
  className = '',
}: CustomerPrivacyExportButtonProps) {
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const handleExport = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (status === 'loading') return

    setStatus('loading')
    setErrorMessage(null)

    try {
      const url = `/api/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}/export`

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      })

      if (!res.ok) {
        let msg = 'Export unavailable'
        if (res.status === 403) {
          msg = 'Not authorized'
        } else if (res.status === 503) {
          msg = 'Temporarily unavailable'
        }
        setStatus('error')
        setErrorMessage(msg)
        return
      }

      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition')
      let filename = `mpg-customer-privacy-export-${customerId}.json`
      if (disposition) {
        const match = disposition.match(/filename="?([^";]+)"?/)
        if (match && match[1]) {
          filename = match[1]
        }
      }

      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)

      setStatus('idle')
    } catch {
      setStatus('error')
      setErrorMessage('Export failed')
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleExport}
        disabled={status === 'loading'}
        title="Export customer privacy data (JSON)"
        aria-label="Export customer privacy data"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
          status === 'loading'
            ? 'bg-[#131E38]/50 text-slate-400 border-[#1C2846] cursor-wait'
            : 'bg-[#131E38] hover:bg-[#1C2846] text-slate-300 hover:text-white border-[#1C2846]'
        } ${className}`}
      >
        <DocumentIcon
          className={`w-3.5 h-3.5 ${
            status === 'loading' ? 'animate-pulse text-blue-400' : 'text-slate-400'
          }`}
        />
        <span>{status === 'loading' ? 'Exporting…' : 'Export Data'}</span>
      </button>
      {status === 'error' && errorMessage && (
        <span
          className="text-[10px] text-rose-400 font-medium px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-800/60"
          role="alert"
        >
          {errorMessage}
        </span>
      )}
    </div>
  )
}

interface CustomerErasureButtonProps {
  organizationId: string
  customerId: string
  customerName?: string
  isErased?: boolean
  className?: string
}

export function CustomerErasureButton({
  organizationId,
  customerId,
  customerName,
  isErased = false,
  className = '',
}: CustomerErasureButtonProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [preflightStatus, setPreflightStatus] = useState<
    'idle' | 'checking' | 'eligible' | 'blocked' | 'error'
  >('idle')
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const runPreflight = useCallback(async () => {
    setPreflightStatus('checking')
    setPreflightMessage(null)
    setSubmitError(null)
    setConfirmText('')

    try {
      const url = `/api/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}/erase`
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const data = await res.json().catch(() => null)

      if (res.status === 200 && data?.status === 'ELIGIBLE') {
        setPreflightStatus('eligible')
        setPreflightMessage(data.message || 'Eligible for erasure.')
      } else if (data?.status === 'BLOCKED') {
        setPreflightStatus('blocked')
        setPreflightMessage(
          data.message ||
            'Erasure blocked because historical delivery evidence cannot be safely resolved.'
        )
      } else if (res.status === 403) {
        setPreflightStatus('error')
        setPreflightMessage('Not authorized')
      } else {
        setPreflightStatus('error')
        setPreflightMessage('Temporarily unavailable')
      }
    } catch {
      setPreflightStatus('error')
      setPreflightMessage('Temporarily unavailable')
    }
  }, [organizationId, customerId])

  const openModal = () => {
    setIsOpen(true)
    runPreflight()
  }

  const closeModal = useCallback(() => {
    if (isSubmitting) return
    setIsOpen(false)
    setPreflightStatus('idle')
    setPreflightMessage(null)
    setConfirmText('')
    setSubmitError(null)
    setIsSuccess(false)
  }, [isSubmitting])

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        closeModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, closeModal])

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault()
    if (confirmText !== 'ERASE' || isSubmitting || preflightStatus !== 'eligible') {
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const url = `/api/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}/erase`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ confirmation: confirmText }),
      })

      const data = await res.json().catch(() => null)

      if (res.ok && data?.success) {
        setIsSuccess(true)
        router.refresh()
        setTimeout(() => {
          closeModal()
        }, 1200)
      } else {
        let msg = data?.error || 'Erasure failed'
        if (res.status === 403) msg = 'Not authorized'
        else if (res.status === 409)
          msg =
            'Erasure blocked because historical delivery evidence cannot be safely resolved'
        else if (res.status === 503) msg = 'Temporarily unavailable'

        setSubmitError(msg)
      }
    } catch {
      setSubmitError('Temporarily unavailable')
    } finally {
      setIsSubmitting(false)
    }
  }

  // If customer is already erased, display tombstone badge
  if (isErased) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border border-slate-700/60 bg-slate-900/60 text-slate-500 cursor-not-allowed select-none ${className}`}
        title="Customer personal data has been erased"
      >
        Erased
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Erase customer data (Owner only)"
        aria-label="Erase customer personal data"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors bg-[#131E38] hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 border-[#1C2846] hover:border-rose-800/60 ${className}`}
      >
        <AlertTriangleIcon className="w-3.5 h-3.5 text-rose-400" />
        <span>Erase Data</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="erasure-modal-title"
        >
          <div className="relative w-full max-w-md bg-[#0A1020] border border-[#1C2846] rounded-xl shadow-2xl p-6 space-y-4 text-white">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-400">
                  <AlertTriangleIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="erasure-modal-title"
                    className="text-sm font-semibold text-white"
                  >
                    Erase Customer Personal Data
                  </h2>
                  <p className="text-xs text-slate-400">
                    {customerName ? `Target: ${customerName}` : 'Owner-only controlled customer erasure'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white transition-colors p-1"
                aria-label="Close dialog"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Destructive Warning */}
            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-xs text-rose-200/90 space-y-1">
              <p className="font-semibold text-rose-300">
                Warning: This action is permanent and cannot be undone.
              </p>
              <p className="text-[11px] leading-relaxed text-rose-200/80">
                Direct personal identifying information (name, email, phone number, and completion contact details) will be permanently erased. Historical failure messages containing customer details will be scrubbed.
              </p>
            </div>

            {/* Preflight Eligibility Banner */}
            <div className="text-xs">
              {preflightStatus === 'checking' && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#0E172B] border border-[#1C2846] text-slate-400">
                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span>Checking erasure eligibility…</span>
                </div>
              )}

              {preflightStatus === 'eligible' && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-emerald-300 text-xs">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{preflightMessage || 'Eligible for erasure.'}</span>
                </div>
              )}

              {preflightStatus === 'blocked' && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/60 text-amber-300 text-xs">
                  <AlertTriangleIcon className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Erasure Blocked</p>
                    <p className="text-[11px] text-amber-300/80 mt-0.5">
                      {preflightMessage ||
                        'Erasure blocked because historical delivery evidence cannot be safely resolved.'}
                    </p>
                  </div>
                </div>
              )}

              {preflightStatus === 'error' && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
                  <AlertTriangleIcon className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{preflightMessage || 'Unable to verify erasure eligibility.'}</span>
                </div>
              )}
            </div>

            {/* Confirmation Form (Only when preflight is ELIGIBLE) */}
            {preflightStatus === 'eligible' && !isSuccess && (
              <form onSubmit={handleExecute} className="space-y-3 pt-1">
                <div>
                  <label
                    htmlFor="confirm-erasure-input"
                    className="block text-xs text-slate-300 font-medium mb-1.5"
                  >
                    To confirm, type <span className="font-bold text-rose-400 font-mono">ERASE</span> below:
                  </label>
                  <input
                    id="confirm-erasure-input"
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    disabled={isSubmitting}
                    placeholder="ERASE"
                    autoComplete="off"
                    className="w-full bg-[#0E172B] border border-[#1C2846] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 font-mono tracking-wider transition-colors"
                  />
                </div>

                {submitError && (
                  <div
                    className="p-2 rounded bg-rose-950/60 border border-rose-800/70 text-rose-300 text-xs"
                    role="alert"
                  >
                    {submitError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 text-xs text-slate-300 hover:text-white rounded-lg border border-[#1C2846] hover:bg-[#131E38] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={confirmText !== 'ERASE' || isSubmitting}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
                  >
                    {isSubmitting ? 'Erasing…' : 'Permanently Erase'}
                  </button>
                </div>
              </form>
            )}

            {/* Success State */}
            {isSuccess && (
              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Customer personal data has been erased successfully.</span>
              </div>
            )}

            {/* Blocked or Error Footer */}
            {(preflightStatus === 'blocked' || preflightStatus === 'error') && (
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3 py-1.5 text-xs text-slate-300 hover:text-white rounded-lg border border-[#1C2846] hover:bg-[#131E38] transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
