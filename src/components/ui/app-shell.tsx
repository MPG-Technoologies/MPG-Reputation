'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  MpgLogoIcon,
  HomeIcon,
  PlusCircleIcon,
  UsersIcon,
  MapPinIcon,
  StarIcon,
  LinkIcon,
  BarChartIcon,
  SettingsIcon,
  HelpCircleIcon,
  BellIcon,
  SearchIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
} from '@/components/ui/icons'
import { signOut } from '@/actions/auth'
import { SubmitButton } from '@/components/ui/submit-button'
import { useModal } from '@/components/ui/modal-system'

export interface AppShellProps {
  children: React.ReactNode
  orgName: string
  userRole: string
  userEmail?: string
  attentionCount?: number
}

interface NavItemConfig {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

const PRIMARY_NAV_ITEMS: NavItemConfig[] = [
  { href: '/app/dashboard', label: 'Dashboard', icon: HomeIcon },
  { href: '/app/quick-complete', label: 'Quick Complete', icon: PlusCircleIcon },
  { href: '/app/customers', label: 'Customers', icon: UsersIcon },
  { href: '/app/settings/location', label: 'Locations', icon: MapPinIcon },
  { href: '/app/settings/review-destination', label: 'Google Destination', icon: StarIcon },
  { href: '/app/settings/integrations', label: 'API & Webhooks', icon: LinkIcon },
  { href: '/app/settings/usage', label: 'Usage & Trial', icon: BarChartIcon },
]

const SECONDARY_NAV_ITEMS: NavItemConfig[] = [
  { href: '/app/settings/location', label: 'Settings', icon: SettingsIcon },
]

function getInitials(name: string): string {
  if (!name) return 'MP'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function AppShell({
  children,
  orgName,
  userRole,
  userEmail,
  attentionCount = 0,
}: AppShellProps) {
  const pathname = usePathname()
  const { openQuickComplete } = useModal()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  const orgInitials = getInitials(orgName)

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false)
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isNavActive = (href: string, exact = false) => {
    if (exact || href === '/app/dashboard') {
      return pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-[#070C18] text-slate-100 flex flex-col xl:flex-row">
      {/* ================================================================ */}
      {/* 1. DESKTOP SIDEBAR (>= 1280px)                                    */}
      {/* ================================================================ */}
      <aside
        className="hidden xl:flex w-64 bg-[#0A1020] border-r border-[#17233F] flex-col justify-between h-screen sticky top-0 shrink-0 z-30 select-none"
        aria-label="Main Navigation"
      >
        <div className="flex flex-col min-h-0">
          {/* Brand Header */}
          <div className="px-5 pt-6 pb-5">
            <Link
              href="/app/dashboard"
              className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg p-1"
            >
              <MpgLogoIcon className="w-8 h-8 shrink-0" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-base tracking-tight">MPG</span>
                  <span className="text-slate-200 font-semibold text-base tracking-tight">
                    Reputation
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                  Build. Grow. Connect.
                </div>
              </div>
            </Link>
          </div>

          {/* Primary Navigation List */}
          <nav className="px-3 space-y-1 overflow-y-auto mt-2 flex-1" aria-label="Primary Navigation">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const active = isNavActive(item.href, item.exact)
              const isQuickComplete = item.href === '/app/quick-complete'
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => {
                    if (isQuickComplete && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      e.preventDefault()
                      openQuickComplete()
                    }
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    active
                      ? 'bg-blue-600 text-white font-semibold shadow-sm shadow-blue-900/40'
                      : 'text-slate-300 hover:text-white hover:bg-[#131E38]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Secondary Navigation & Account Area */}
        <div className="p-3 border-t border-[#17233F] space-y-1">
          {SECONDARY_NAV_ITEMS.map((item) => {
            const active = isNavActive(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#131E38] text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#131E38]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0 text-slate-400" />
                <span>{item.label}</span>
              </Link>
            )
          })}

          <button
            type="button"
            onClick={() => alert('MPG Reputation Support: support@mpg.internal')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-[#131E38] transition-colors text-left cursor-pointer"
          >
            <HelpCircleIcon className="w-4 h-4 shrink-0 text-slate-400" />
            <span>Help</span>
          </button>
        </div>
      </aside>

      {/* ================================================================ */}
      {/* 2. TABLET HEADER (768px – 1279px)                                 */}
      {/* ================================================================ */}
      <header
        className="hidden md:flex xl:hidden h-16 bg-[#0A1020]/95 backdrop-blur-sm border-b border-[#17233F] px-6 items-center justify-between sticky top-0 z-20 shrink-0"
        aria-label="Tablet Header"
      >
        <Link href="/app/dashboard" className="flex items-center gap-2.5">
          <MpgLogoIcon className="w-7 h-7" />
          <div className="flex items-center gap-1">
            <span className="font-bold text-white text-base">MPG</span>
            <span className="text-slate-200 font-semibold text-base">Reputation</span>
          </div>
        </Link>

        <div className="flex items-center gap-4">
          {/* Notification Button */}
          <button
            type="button"
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="p-2 text-slate-400 hover:text-white rounded-lg relative hover:bg-[#131E38] transition-colors cursor-pointer"
            aria-label={`Notifications ${attentionCount > 0 ? `(${attentionCount} new)` : ''}`}
          >
            <BellIcon className="w-5 h-5" />
            {attentionCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#0A1020]" />
            )}
          </button>

          <div className="h-6 w-px bg-[#17233F]" />

          {/* User Account Pill */}
          <div className="relative" ref={accountRef}>
            <button
              type="button"
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              className="flex items-center gap-2.5 hover:bg-[#131E38] py-1 px-2 rounded-lg transition-colors text-left cursor-pointer"
              aria-expanded={accountMenuOpen}
              aria-haspopup="true"
            >
              <div className="w-8 h-8 rounded-full bg-blue-700/60 border border-blue-500/40 text-white font-semibold flex items-center justify-center text-xs">
                {orgInitials}
              </div>
              <div className="text-xs leading-tight">
                <div className="font-medium text-white max-w-[130px] truncate">{orgName}</div>
                <div className="text-[11px] text-slate-400 capitalize">{userRole.toLowerCase()}</div>
              </div>
              <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* Dropdown Menu */}
            {accountMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#0E172B] border border-[#1E2C4F] rounded-xl shadow-2xl py-2 z-50 text-xs">
                <div className="px-4 py-2 border-b border-[#1E2C4F]">
                  <div className="font-semibold text-white truncate">{orgName}</div>
                  <div className="text-slate-400 truncate">{userEmail || 'Active Workspace'}</div>
                </div>
                <Link
                  href="/app/settings/location"
                  onClick={() => setAccountMenuOpen(false)}
                  className="block px-4 py-2 text-slate-300 hover:bg-[#131E38] hover:text-white"
                >
                  Workspace Settings
                </Link>
                <div className="border-t border-[#1E2C4F] mt-1 pt-1 px-2">
                  <form action={signOut}>
                    <SubmitButton
                      pendingText="Signing out…"
                      className="w-full text-left px-3 py-1.5 text-rose-400 hover:bg-rose-950/40 rounded-md transition-colors cursor-pointer"
                    >
                      Sign Out
                    </SubmitButton>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ================================================================ */}
      {/* 3. MOBILE HEADER (< 768px)                                        */}
      {/* ================================================================ */}
      <header
        className="flex md:hidden h-14 bg-[#0A1020]/95 backdrop-blur-sm border-b border-[#17233F] px-4 items-center justify-between sticky top-0 z-20 shrink-0 pt-safe"
        aria-label="Mobile Header"
      >
        <Link href="/app/dashboard" className="flex items-center gap-2">
          <MpgLogoIcon className="w-6 h-6" />
          <div className="flex items-center gap-1">
            <span className="font-bold text-white text-sm">MPG</span>
            <span className="text-slate-200 font-medium text-sm">REPUTATION</span>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => setMoreMenuOpen(true)}
          className="p-2 text-slate-400 hover:text-white rounded-lg relative hover:bg-[#131E38] transition-colors cursor-pointer"
          aria-label="Notifications and Menu"
        >
          <BellIcon className="w-5 h-5" />
          {attentionCount > 0 && (
            <span className="absolute top-1 right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
              {attentionCount}
            </span>
          )}
        </button>
      </header>

      {/* ================================================================ */}
      {/* 4. MAIN APPLICATION WORKSPACE                                     */}
      {/* ================================================================ */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 xl:pb-6">
        {/* Desktop Workspace Top Utility Area */}
        <div className="hidden xl:flex items-center justify-end px-8 py-3.5 border-b border-[#17233F]/60 gap-4">
          {/* Search Trigger */}
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="p-2 text-slate-400 hover:text-white hover:bg-[#0E172B] rounded-lg transition-colors cursor-pointer"
            aria-label="Search"
          >
            <SearchIcon className="w-4 h-4" />
          </button>

          {/* Notifications Trigger */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="p-2 text-slate-400 hover:text-white hover:bg-[#0E172B] rounded-lg relative transition-colors cursor-pointer"
              aria-label={`Notifications ${attentionCount > 0 ? `(${attentionCount} new)` : ''}`}
            >
              <BellIcon className="w-4 h-4" />
              {attentionCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#070C18]" />
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-[#0E172B] border border-[#1E2C4F] rounded-xl shadow-2xl p-3 z-50 text-xs">
                <div className="font-semibold text-white pb-2 border-b border-[#1E2C4F] flex justify-between items-center">
                  <span>System Notifications</span>
                  {attentionCount > 0 && (
                    <span className="bg-rose-950 text-rose-300 px-1.5 py-0.5 rounded text-[10px] border border-rose-800">
                      {attentionCount} attention
                    </span>
                  )}
                </div>
                <div className="py-2 text-slate-400 text-xs">
                  {attentionCount > 0
                    ? `${attentionCount} items require operational review on your dashboard.`
                    : 'All systems operational. No active issues.'}
                </div>
                <Link
                  href="/app/dashboard"
                  onClick={() => setNotificationsOpen(false)}
                  className="block text-center text-blue-400 hover:text-blue-300 pt-1 text-[11px] font-medium"
                >
                  View Dashboard Status →
                </Link>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-[#17233F]" />

          {/* User Account Avatar & Dropdown */}
          <div className="relative" ref={accountRef}>
            <button
              type="button"
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              className="flex items-center gap-2 hover:bg-[#0E172B] py-1 px-1.5 rounded-lg transition-colors cursor-pointer"
              aria-expanded={accountMenuOpen}
              aria-haspopup="true"
            >
              <div className="w-7 h-7 rounded-full bg-blue-600 border border-blue-400/40 text-white font-bold flex items-center justify-center text-xs">
                {orgInitials}
              </div>
              <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {accountMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#0E172B] border border-[#1E2C4F] rounded-xl shadow-2xl py-2 z-50 text-xs">
                <div className="px-4 py-2 border-b border-[#1E2C4F]">
                  <div className="font-semibold text-white truncate">{orgName}</div>
                  <div className="text-slate-400 capitalize">{userRole.toLowerCase()} role</div>
                </div>
                <Link
                  href="/app/settings/location"
                  onClick={() => setAccountMenuOpen(false)}
                  className="block px-4 py-2 text-slate-300 hover:bg-[#131E38] hover:text-white"
                >
                  Workspace Settings
                </Link>
                <div className="border-t border-[#1E2C4F] mt-1 pt-1 px-2">
                  <form action={signOut}>
                    <SubmitButton
                      pendingText="Signing out…"
                      className="w-full text-left px-3 py-1.5 text-rose-400 hover:bg-rose-950/40 rounded-md transition-colors cursor-pointer"
                    >
                      Sign Out
                    </SubmitButton>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        <main className="flex-1 w-full min-w-0 min-h-0 flex flex-col">
          {children}
        </main>
      </div>

      {/* ================================================================ */}
      {/* 5. RESPONSIVE BOTTOM NAVIGATION (< 1280px Tablet & Mobile)        */}
      {/* ================================================================ */}
      <nav
        className="xl:hidden fixed bottom-0 left-0 right-0 bg-[#0A1020]/95 backdrop-blur-md border-t border-[#17233F] z-30 pb-safe"
        aria-label="Bottom Navigation"
      >
        <div className="grid grid-cols-4 h-14 sm:h-16 max-w-lg mx-auto">
          {/* Home / Dashboard */}
          <Link
            href="/app/dashboard"
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
              isNavActive('/app/dashboard', true)
                ? 'text-blue-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HomeIcon className="w-5 h-5" />
            <span>Dashboard</span>
          </Link>

          {/* Customers */}
          <Link
            href="/app/customers"
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
              isNavActive('/app/customers')
                ? 'text-blue-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UsersIcon className="w-5 h-5" />
            <span>Customers</span>
          </Link>

          {/* Locations */}
          <Link
            href="/app/settings/location"
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
              isNavActive('/app/settings/location')
                ? 'text-blue-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapPinIcon className="w-5 h-5" />
            <span>Locations</span>
          </Link>

          {/* More Menu Drawer Trigger */}
          <button
            type="button"
            onClick={() => setMoreMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
            aria-label="Open More Menu"
          >
            <MoreHorizontalIcon className="w-5 h-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* ================================================================ */}
      {/* 6. "MORE" MENU DRAWER / BOTTOM SHEET                              */}
      {/* ================================================================ */}
      {moreMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMoreMenuOpen(false)}
          />

          {/* Sheet / Modal Container */}
          <div className="relative bg-[#0E172B] border border-[#1E2C4F] rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 z-10 space-y-4 pb-safe sm:pb-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E2C4F]">
              <div className="font-bold text-white text-base">Workspace &amp; Navigation</div>
              <button
                type="button"
                onClick={() => setMoreMenuOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                href="/app/quick-complete"
                onClick={(e) => {
                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                    e.preventDefault()
                    setMoreMenuOpen(false)
                    openQuickComplete()
                  }
                }}
                className="flex items-center gap-2.5 p-3 rounded-lg bg-[#131E38] hover:bg-[#192748] text-white font-medium"
              >
                <PlusCircleIcon className="w-4 h-4 text-blue-400" />
                <span>Quick Complete</span>
              </Link>

              <Link
                href="/app/settings/review-destination"
                onClick={() => setMoreMenuOpen(false)}
                className="flex items-center gap-2.5 p-3 rounded-lg bg-[#131E38] hover:bg-[#192748] text-white font-medium"
              >
                <StarIcon className="w-4 h-4 text-amber-400" />
                <span>Google Destination</span>
              </Link>

              <Link
                href="/app/settings/integrations"
                onClick={() => setMoreMenuOpen(false)}
                className="flex items-center gap-2.5 p-3 rounded-lg bg-[#131E38] hover:bg-[#192748] text-white font-medium"
              >
                <LinkIcon className="w-4 h-4 text-cyan-400" />
                <span>API &amp; Webhooks</span>
              </Link>

              <Link
                href="/app/settings/usage"
                onClick={() => setMoreMenuOpen(false)}
                className="flex items-center gap-2.5 p-3 rounded-lg bg-[#131E38] hover:bg-[#192748] text-white font-medium"
              >
                <BarChartIcon className="w-4 h-4 text-emerald-400" />
                <span>Usage &amp; Trial</span>
              </Link>
            </div>

            <div className="pt-2 border-t border-[#1E2C4F] flex items-center justify-between text-xs">
              <div>
                <div className="font-semibold text-white truncate">{orgName}</div>
                <div className="text-slate-400 capitalize">{userRole.toLowerCase()}</div>
              </div>
              <form action={signOut}>
                <SubmitButton
                  pendingText="Signing out…"
                  className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 rounded-md border border-rose-800/80 cursor-pointer"
                >
                  Sign Out
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
