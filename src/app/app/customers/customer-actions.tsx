'use client'

import React from 'react'
import Link from 'next/link'
import { PlusCircleIcon } from '@/components/ui/icons'
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
