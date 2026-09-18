'use client'

import type { ConnectionState } from '@/lib/dashboard/realtime-types'

interface RealtimeStatusProps {
  status: ConnectionState
}

export function RealtimeStatus({ status }: RealtimeStatusProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'LIVE':
        return {
          dotClass: 'bg-emerald-400 ring-emerald-500/20',
          text: 'Live',
          ariaLabel: 'Realtime connection active: Live',
          textColor: 'text-emerald-400',
        }
      case 'RECONNECTING':
        return {
          dotClass: 'bg-amber-400 ring-amber-500/20 animate-pulse',
          text: 'Reconnecting…',
          ariaLabel: 'Realtime connection lost: Reconnecting…',
          textColor: 'text-amber-400',
        }
      case 'SYNCING':
        return {
          dotClass: 'bg-blue-400 ring-blue-500/20 animate-pulse',
          text: 'Syncing…',
          ariaLabel: 'Synchronizing with server data: Syncing…',
          textColor: 'text-blue-400',
        }
      case 'OFFLINE':
      default:
        return {
          dotClass: 'bg-slate-500 ring-slate-600/20',
          text: 'Offline',
          ariaLabel: 'Realtime connection inactive: Offline',
          textColor: 'text-slate-400',
        }
    }
  }

  const config = getStatusConfig()

  return (
    <div
      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium"
      role="status"
      aria-label={config.ariaLabel}
    >
      <span
        className={`w-2 h-2 rounded-full ring-2 transition-colors ${config.dotClass}`}
        aria-hidden="true"
      />
      <span className={config.textColor}>{config.text}</span>
    </div>
  )
}
