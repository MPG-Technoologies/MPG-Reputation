'use client'

import React from 'react'
import Link from 'next/link'
import { PlusCircleIcon, DocumentIcon } from '@/components/ui/icons'
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
