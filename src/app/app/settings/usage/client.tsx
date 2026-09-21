'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  OrganizationUsageSummary,
  startOrganizationTrialAction,
  provisionOrganizationTrialAction,
} from '@/actions/usage'
import { AlertTriangleIcon } from '@/components/ui/icons'

interface UsageClientProps {
  organizationId: string
  userRole: string
  initialUsage: OrganizationUsageSummary | null
}

function formatUsageTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Invalid timestamp'
  }

  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

export function UsageClient({
  organizationId,
  userRole,
  initialUsage,
}: UsageClientProps) {
  const usage = initialUsage
  const [isStartingTrial, setIsStartingTrial] = useState(false)
  const [startMessage, setStartMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [isProvisioning, setIsProvisioning] = useState(false)
  const [provisionMessage, setProvisionMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const isOwnerOrAdmin = ['OWNER', 'ADMIN'].includes(userRole)
  const entitlement = usage?.entitlement
  const counts = usage?.ledgerCounts

  const handleStartTrial = async () => {
    setIsStartingTrial(true)
    setStartMessage(null)

    const res = await startOrganizationTrialAction(organizationId)
    setIsStartingTrial(false)

    if (res.success) {
      setStartMessage({
        type: 'success',
        text: 'Trial successfully activated. Review automation is now active for this organization.',
      })
      window.location.reload()
    } else {
      setStartMessage({
        type: 'error',
        text: res.error || 'Failed to start trial',
      })
    }
  }

  const handleReprovision = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsProvisioning(true)
    setProvisionMessage(null)

    const formData = new FormData(e.currentTarget)
    const requests = parseInt(formData.get('allocatedRequests') as string, 10) || 30
    const durationDays = parseInt(formData.get('durationDays') as string, 10) || 30

    const res = await provisionOrganizationTrialAction(organizationId, requests, durationDays)
    setIsProvisioning(false)

    if (res.success) {
      setProvisionMessage({
        type: 'success',
        text: `Trial allowance configured with ${requests} requests for ${durationDays} days.`,
      })
      window.location.reload()
    } else {
      setProvisionMessage({
        type: 'error',
        text: res.error || 'Failed to update trial entitlement',
      })
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80">
            Active Trial
          </span>
        )
      case 'NOT_STARTED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-950/60 text-amber-300 border border-amber-800/80">
            Trial Ready (Not Started)
          </span>
        )
      case 'EXHAUSTED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-950/60 text-amber-400 border border-amber-800/80">
            Allowance Exhausted
          </span>
        )
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-rose-950/60 text-rose-300 border border-rose-800/80">
            Trial Expired
          </span>
        )
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-rose-950/60 text-rose-300 border border-rose-800/80">
            Suspended
          </span>
        )
      case 'ENDED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-400 border border-slate-700">
            Ended
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-400 border border-slate-700">
            {status}
          </span>
        )
    }
  }

  const consumed = entitlement?.consumedRequests ?? 0
  const allocated = entitlement?.allocatedRequests ?? 30
  const remaining = entitlement?.remainingRequests ?? 0
  const percentUsed = allocated > 0 ? Math.min(100, Math.round((consumed / allocated) * 100)) : 0
  const isNotStarted = entitlement?.effectiveStatus === 'NOT_STARTED' || entitlement?.status === 'NOT_STARTED'

  return (
    <div className="space-y-6">
      {/* 1. Entitlement Hypothesis Notice */}
      <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-4 text-xs text-blue-300 leading-relaxed">
        <span className="font-semibold uppercase tracking-wider text-blue-400">
          Validation Hypothesis — MR-4:
        </span>{' '}
        Default allowance of 30 review requests or 30 days is a product validation hypothesis and
        operational test limit. It does not represent contractual pricing or a public commercial
        commitment. Billing infrastructure remains deactivated until authorized milestone MR-5.
      </div>

      {/* 2. Explicit Trial Activation Callout (when NOT_STARTED) */}
      {isNotStarted && (
        <div className="rounded-xl border border-amber-900/50 bg-[#0E172B] p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">Trial Ready for Activation</h2>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Your trial has been provisioned with an evaluation allowance of {allocated} requests.
                Customer completions received before explicit activation will consume zero allowance and will not send live invitations.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2">
                <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                  <span className="text-white font-semibold">{allocated}</span> review requests provisioned
                </span>
                <span className="text-slate-600">•</span>
                <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                  <span className="text-white font-semibold">{entitlement?.durationDays ?? 30}-day</span> evaluation period
                </span>
              </div>
            </div>
            {isOwnerOrAdmin && (
              <div className="shrink-0">
                {usage?.canStartTrial ? (
                  <button
                    onClick={handleStartTrial}
                    disabled={isStartingTrial}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm shadow-emerald-900/30 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    {isStartingTrial ? 'Starting Trial...' : 'Start Trial'}
                  </button>
                ) : (
                  <Link
                    href="/app/settings/review-destination"
                    className="inline-block px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    Set Up Ready Location First
                  </Link>
                )}
              </div>
            )}
          </div>

          {!usage?.canStartTrial && (
            <div className="text-xs text-amber-300/90 bg-amber-950/40 p-3 rounded-lg border border-amber-500/20">
              <strong>Prerequisite:</strong> At least one active location with a tested and confirmed Google review destination is required before starting the trial.
            </div>
          )}

          {startMessage && (
            <div
              className={`p-3 rounded-lg text-xs ${
                startMessage.type === 'success'
                  ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800'
                  : 'bg-rose-950/40 text-rose-400 border border-rose-800'
              }`}
            >
              {startMessage.text}
            </div>
          )}
        </div>
      )}

      {/* 3. Trial Status & Allowance Card */}
      <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#1C2846]">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-white tracking-tight">Trial Entitlement Allowance</h2>
              {getStatusBadge(entitlement?.effectiveStatus || 'NOT_STARTED')}
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Server-authoritative consumption ledger and concurrency-safe limit enforcement.
            </p>
          </div>

          {/* Factual consistency in allowance display */}
          <div className="sm:text-right">
            {isNotStarted ? (
              <>
                <div className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
                  {allocated}{' '}
                  <span className="text-xs font-normal text-slate-400 font-sans">requests provisioned</span>
                </div>
                <div className="text-xs text-amber-400/90 mt-0.5">
                  Awaiting trial start · {consumed} consumed
                </div>
              </>
            ) : (
              <>
                <div className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
                  {remaining}{' '}
                  <span className="text-xs font-normal text-slate-400 font-sans">requests remaining</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {consumed} of {allocated} requests consumed
                </div>
              </>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-5 space-y-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Allowance Utilization</span>
            <span className="font-mono">{percentUsed}%</span>
          </div>
          <div className="w-full bg-[#0A1020] rounded-full h-2 overflow-hidden border border-[#1C2846]/60">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                percentUsed >= 100
                  ? 'bg-amber-500'
                  : percentUsed > 80
                  ? 'bg-amber-400'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
        </div>

        {/* Entitlement Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5 pt-4 border-t border-[#1C2846] text-xs">
          <div>
            <span className="text-slate-400">Trial Started:</span>{' '}
            <span className="text-slate-300 font-mono text-[11px] ml-1">
              {entitlement?.startedAt
                ? formatUsageTimestamp(entitlement.startedAt)
                : 'Not started (awaiting explicit activation)'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Trial Expires:</span>{' '}
            <span className="text-slate-300 font-mono text-[11px] ml-1">
              {entitlement?.expiresAt
                ? formatUsageTimestamp(entitlement.expiresAt)
                : `${entitlement?.durationDays ?? 30} days after start`}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Factual Usage Counts (Ledger Summary, calm statistical presentation) */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Factual Usage Accounting (Ledger Summary)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-4">
            <div className="text-xs text-slate-400">Initial Requests</div>
            <div className="text-lg sm:text-xl font-bold text-white mt-1 font-mono">
              {counts?.initialRequestsCreated ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Consumes allowance</div>
          </div>

          <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-4">
            <div className="text-xs text-slate-400">Reminders Created</div>
            <div className="text-lg sm:text-xl font-bold text-white mt-1 font-mono">
              {counts?.remindersCreated ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Separate accounting</div>
          </div>

          <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-4">
            <div className="text-xs text-slate-400">Provider Attempts</div>
            <div className="text-lg sm:text-xl font-bold text-white mt-1 font-mono">
              {counts?.providerSendAttempts ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {counts?.providerSendSuccesses ?? 0} sent, {counts?.providerSendFailures ?? 0} failed
            </div>
          </div>

          <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-4">
            <div className="text-xs text-slate-400">Tracked Clicks</div>
            <div className="text-lg sm:text-xl font-bold text-white mt-1 font-mono">
              {counts?.trackedClicks ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Verified redirects</div>
          </div>
        </div>
      </div>

      {/* 5. Recent Usage Ledger Events (Audit Record) */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Append-Only Usage Ledger (Audit Record)
        </h3>
        <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1C2846] text-slate-400 bg-[#0A1020] uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3 px-5 font-medium">Timestamp</th>
                  <th scope="col" className="py-3 px-4 font-medium">Event Type</th>
                  <th scope="col" className="py-3 px-4 font-medium">Channel</th>
                  <th scope="col" className="py-3 px-4 font-medium">Units</th>
                  <th scope="col" className="py-3 px-5 font-medium">Idempotency Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2846]/70 text-slate-300 font-mono text-[11px]">
                {usage?.recentEvents && usage.recentEvents.length > 0 ? (
                  usage.recentEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-[#131E38]/40 transition-colors">
                      <td className="py-3 px-5 font-sans text-slate-400 whitespace-nowrap text-xs">
                        {formatUsageTimestamp(ev.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-white font-medium">{ev.eventType}</td>
                      <td className="py-3 px-4 text-slate-400">{ev.channel}</td>
                      <td className="py-3 px-4">{ev.units}</td>
                      <td className="py-3 px-5 text-slate-500 text-[10px] truncate max-w-[200px]">
                        {ev.idempotencyKey}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 font-sans text-xs">
                      No usage events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 6. Operator Trial Configuration (Owner/Admin) */}
      {isOwnerOrAdmin && (
        <div className="rounded-xl border border-[#1C2846] bg-[#0E172B] p-5 sm:p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white tracking-tight">
            Configure Entitlement Allowance (Pilot Operator)
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Modify or re-provision the organization trial allowance parameters.
          </p>

          <form onSubmit={handleReprovision} className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Allocated Review Requests
              </label>
              <input
                type="number"
                name="allocatedRequests"
                defaultValue={allocated}
                min={1}
                max={1000}
                required
                className="w-full bg-[#0A1020] border border-[#1C2846] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Duration (Days)
              </label>
              <input
                type="number"
                name="durationDays"
                defaultValue={entitlement?.durationDays ?? 30}
                min={1}
                max={365}
                required
                className="w-full bg-[#0A1020] border border-[#1C2846] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isProvisioning}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-sm shadow-blue-900/30 cursor-pointer"
              >
                {isProvisioning ? 'Updating...' : 'Update Allowance'}
              </button>
            </div>
          </form>

          {provisionMessage && (
            <div
              className={`p-3 rounded-lg text-xs ${
                provisionMessage.type === 'success'
                  ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800'
                  : 'bg-rose-950/40 text-rose-400 border border-rose-800'
              }`}
            >
              {provisionMessage.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
