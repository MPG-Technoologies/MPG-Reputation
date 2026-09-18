'use client'

import React from 'react'
import { useFormStatus } from 'react-dom'

export interface SubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pendingText?: string
  children?: React.ReactNode
}

export function SubmitButton({
  pendingText,
  children,
  className = '',
  disabled,
  formAction,
  ...props
}: SubmitButtonProps) {
  const { pending, action } = useFormStatus()

  // Determine if this specific button triggered the pending submission
  const isThisPending = Boolean(
    pending && (formAction ? action === formAction : true)
  )
  const isAnyPending = pending

  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={disabled || isAnyPending}
      aria-busy={isThisPending}
      className={`${className} disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 inline-flex items-center justify-center gap-2`}
      {...props}
    >
      {isThisPending ? (
        <>
          <svg
            className="animate-spin -ml-1 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span>{pendingText || 'Submitting…'}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
