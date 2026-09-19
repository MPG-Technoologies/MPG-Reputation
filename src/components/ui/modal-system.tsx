'use client'

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import { QuickCompleteForm } from '@/app/app/quick-complete/form'
import { XIcon } from '@/components/ui/icons'

export interface ReadyLocation {
  id: string
  name: string
}

interface ModalContextType {
  openQuickComplete: () => void
  closeQuickComplete: () => void
  isQuickCompleteOpen: boolean
}

const ModalContext = createContext<ModalContextType | null>(null)

export function useModal() {
  const ctx = useContext(ModalContext)
  if (!ctx) {
    throw new Error('useModal must be used within a ModalProvider')
  }
  return ctx
}

export interface ModalProviderProps {
  children: React.ReactNode
  organizationId: string
  readyLocations: ReadyLocation[]
  isReady: boolean
}

export function ModalProvider({
  children,
  organizationId,
  readyLocations,
  isReady,
}: ModalProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const openQuickComplete = useCallback(() => {
    previousActiveElement.current = document.activeElement as HTMLElement
    setIsOpen(true)
  }, [])

  const closeQuickComplete = useCallback(() => {
    setIsOpen(false)
    if (previousActiveElement.current) {
      previousActiveElement.current.focus()
    }
  }, [])

  // Lock body scroll and listen for Escape key
  useEffect(() => {
    if (!isOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeQuickComplete()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    // Focus first focusable element in modal
    const timer = setTimeout(() => {
      if (modalRef.current) {
        const focusable = modalRef.current.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        focusable?.focus()
      }
    }, 50)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
      clearTimeout(timer)
    }
  }, [isOpen, closeQuickComplete])

  return (
    <ModalContext.Provider
      value={{
        openQuickComplete,
        closeQuickComplete,
        isQuickCompleteOpen: isOpen,
      }}
    >
      {children}

      {/* Global Quick Complete Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs animate-page-enter"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeQuickComplete()
            }
          }}
          role="presentation"
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-complete-modal-title"
            className="w-full sm:max-w-xl bg-[#0E172B] border border-[#1C2846] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[85vh] animate-page-enter"
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#1C2846] flex items-center justify-between shrink-0">
              <div>
                <h2
                  id="quick-complete-modal-title"
                  className="text-base font-bold text-white tracking-tight"
                >
                  Quick Complete
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Record completed customer interaction to trigger the review workflow.
                </p>
              </div>

              <button
                type="button"
                onClick={closeQuickComplete}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#131E38] transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto min-h-0 flex-1">
              {!isReady && readyLocations.length === 0 ? (
                <div className="p-4 rounded-lg bg-amber-950/40 border border-amber-800 text-xs text-amber-200 leading-relaxed">
                  <div className="font-semibold text-amber-100 mb-1">
                    Setup required before Quick Complete can dispatch
                  </div>
                  An active location must have a tested and confirmed Google review destination URL before review requests can be dispatched.
                </div>
              ) : (
                <QuickCompleteForm
                  organizationId={organizationId}
                  locations={readyLocations}
                  onSuccess={closeQuickComplete}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  )
}
