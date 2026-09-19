'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNavigation } from './nav-context'

interface NavItem {
  href: string
  label: string
  exact?: boolean
}

const navItems: NavItem[] = [
  { href: '/app/dashboard', label: 'Dashboard' },
  { href: '/app/quick-complete', label: 'Quick Complete' },
  { href: '/app/settings/location', label: 'Locations' },
  { href: '/app/settings/review-destination', label: 'Google Destination' },
  { href: '/app/settings/integrations', label: 'API & Webhooks' },
]

export function AppNav() {
  const pathname = usePathname()
  const { navigateTo, pendingPath } = useNavigation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isActive = (item: NavItem) => {
    if (item.exact) {
      return pathname === item.href
    }
    return pathname.startsWith(item.href)
  }

  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    active: boolean
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return
    }
    if (active) {
      return
    }
    e.preventDefault()
    setMobileMenuOpen(false)
    navigateTo(href)
  }

  return (
    <div>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
        {navItems.map((item) => {
          const active = isActive(item)
          const isPending = pendingPath === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={(e) => handleNavClick(e, item.href, active)}
              className={`px-3 py-1.5 rounded-md transition-all duration-150 flex items-center gap-2 ${
                active
                  ? 'bg-slate-800 text-white font-semibold border border-slate-700/80 shadow-sm'
                  : isPending
                  ? 'bg-blue-950/60 text-blue-200 border border-blue-700/80 animate-pulse'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {item.label}
              {isPending && (
                <svg
                  className="animate-spin h-3.5 w-3.5 text-blue-400"
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
              )}
            </Link>
          )
        })}
      </nav>

      {/* Mobile Toggle Button */}
      <div className="md:hidden flex items-center">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Navigation Menu"
          aria-expanded={mobileMenuOpen}
          className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {mobileMenuOpen ? (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-slate-900 border-b border-slate-800 px-4 py-3 space-y-1 shadow-2xl z-20">
          {navItems.map((item) => {
            const active = isActive(item)
            const isPending = pendingPath === item.href

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                onClick={(e) => handleNavClick(e, item.href, active)}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-base font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white font-semibold'
                    : isPending
                    ? 'bg-blue-950/70 text-blue-200 border border-blue-700 animate-pulse'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                {isPending && (
                  <svg
                    className="animate-spin h-4 w-4 text-blue-400"
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
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
