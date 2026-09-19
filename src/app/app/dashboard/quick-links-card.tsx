'use client'

import React from 'react'
import Link from 'next/link'
import {
  PlusCircleIcon,
  MapPinIcon,
  StarIcon,
  ChevronRightIcon,
} from '@/components/ui/icons'

export const QuickLinksCard = React.memo(function QuickLinksCard() {
  const links = [
    {
      href: '/app/quick-complete',
      label: 'Quick Complete',
      description: 'Record customer interaction',
      icon: PlusCircleIcon,
      color: 'text-blue-400 bg-blue-950/40 border-blue-800/40',
    },
    {
      href: '/app/settings/location',
      label: 'Manage Locations',
      description: 'Business branches & status',
      icon: MapPinIcon,
      color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
    },
    {
      href: '/app/settings/review-destination',
      label: 'Google Destination',
      description: 'Confirmed review destination URL',
      icon: StarIcon,
      color: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
    },
    {
      href: '/app/settings/usage',
      label: 'Usage & Trial',
      description: 'Allowance & messaging metrics',
      icon: StarIcon,
      color: 'text-indigo-400 bg-indigo-950/40 border-indigo-800/40',
    },
  ]

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-white">Quick Links</h2>
        <span className="text-[11px] text-slate-500 block mt-0.5">
          Operational shortcuts
        </span>
      </div>

      <div className="p-2 divide-y divide-slate-800/60">
        {links.map((link) => {
          const Icon = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center justify-between p-3 rounded-md hover:bg-slate-800/60 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-1.5 rounded-md border shrink-0 ${link.color}`}
                  aria-hidden="true"
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-200 group-hover:text-white transition-colors">
                    {link.label}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {link.description}
                  </div>
                </div>
              </div>
              <ChevronRightIcon className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" />
            </Link>
          )
        })}
      </div>
    </div>
  )
})
