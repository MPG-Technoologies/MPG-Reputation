'use client'

import { useState } from 'react'
import {
  createCompletionCredential,
  revokeCompletionCredential,
  type CreatedCredentialResult,
  type CredentialListItem,
  type IngestionLogItem,
} from '@/actions/completion-credentials'

interface IntegrationsClientProps {
  organizationId: string
  initialCredentials: CredentialListItem[]
  initialLogs: IngestionLogItem[]
  userRole: string
}

export function IntegrationsClient({
  organizationId,
  initialCredentials,
  initialLogs,
  userRole,
}: IntegrationsClientProps) {
  const [credentials, setCredentials] = useState<CredentialListItem[]>(
    initialCredentials
  )
  const [logs] = useState<IngestionLogItem[]>(initialLogs)
  const [activeTab, setActiveTab] = useState<'credentials' | 'logs' | 'guide'>('credentials')

  // Create form state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [rateLimit, setRateLimit] = useState(60)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // One-time newly generated key state
  const [newKey, setNewKey] = useState<CreatedCredentialResult | null>(null)
  const [copied, setCopied] = useState(false)

  const isOwnerOrAdmin = ['OWNER', 'ADMIN'].includes(userRole)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setErrorMsg(null)

    try {
      const result = await createCompletionCredential({
        organizationId,
        name: keyName || 'Completion API Key',
        rateLimitPerMinute: rateLimit,
      })

      if (result.success && result.credential) {
        setNewKey(result.credential)
        setCredentials((prev) => [
          {
            id: result.credential!.id,
            name: result.credential!.name,
            status: 'ACTIVE',
            rateLimitPerMinute: result.credential!.rateLimitPerMinute,
            lastUsedAt: null,
            revokedAt: null,
            createdAt: result.credential!.createdAt,
          },
          ...prev,
        ])
        setShowCreateModal(false)
        setKeyName('')
        setRateLimit(60)
      } else {
        setErrorMsg(result.error || 'Failed to create credential')
      }
    } catch {
      setErrorMsg('An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevoke = async (credentialId: string) => {
    if (
      !confirm(
        'Are you sure you want to revoke this API credential? Any active integration using it will immediately be rejected.'
      )
    ) {
      return
    }

    try {
      const result = await revokeCompletionCredential({
        organizationId,
        credentialId,
      })

      if (result.success) {
        setCredentials((prev) =>
          prev.map((c) =>
            c.id === credentialId
              ? { ...c, status: 'REVOKED', revokedAt: new Date().toISOString() }
              : c
          )
        )
      } else {
        alert(result.error || 'Failed to revoke credential')
      }
    } catch {
      alert('An error occurred while revoking credential')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div className="space-y-5">
      {/* Newly created credential alert */}
      {newKey && (
        <div className="bg-amber-950/40 border border-amber-500/80 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
            <svg
              className="w-5 h-5 text-amber-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            Save Your API Key Now
          </div>
          <p className="text-xs text-amber-200/80 leading-relaxed">
            This API key will <strong>never be displayed again</strong>. Store it securely in your
            integration environment or secrets manager.
          </p>
          <div className="flex items-center gap-2 bg-[#0A1020] p-2.5 rounded-lg border border-amber-900/60">
            <code className="text-xs font-mono text-amber-100 flex-1 break-all select-all">
              {newKey.apiKey}
            </code>
            <button
              onClick={() => copyToClipboard(newKey.apiKey)}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold rounded transition cursor-pointer"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-slate-400 hover:text-slate-200 underline mt-1 cursor-pointer"
          >
            I have saved this key safely
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[#1C2846] gap-6 text-xs font-medium">
        <button
          onClick={() => setActiveTab('credentials')}
          className={`pb-3 transition cursor-pointer ${
            activeTab === 'credentials'
              ? 'text-white border-b-2 border-blue-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          API Credentials ({credentials.length})
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`pb-3 transition cursor-pointer ${
            activeTab === 'logs'
              ? 'text-white border-b-2 border-blue-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Ingestion Logs ({logs.length})
        </button>
        <button
          onClick={() => setActiveTab('guide')}
          className={`pb-3 transition cursor-pointer ${
            activeTab === 'guide'
              ? 'text-white border-b-2 border-blue-500 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Integration Guide
        </button>
      </div>

      {/* Tab: API Credentials */}
      {activeTab === 'credentials' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Credentials authenticate external completion webhooks into the review workflow.
            </p>
            {isOwnerOrAdmin && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm shadow-blue-900/30 transition cursor-pointer"
              >
                + Generate Key
              </button>
            )}
          </div>

          {showCreateModal && (
            <div className="bg-[#0E172B] border border-[#1C2846] rounded-xl p-5 space-y-4 max-w-lg">
              <h3 className="text-sm font-semibold text-white">Create New Completion API Key</h3>
              {errorMsg && (
                <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800 p-2 rounded">
                  {errorMsg}
                </div>
              )}
              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Credential Name / Source Label
                  </label>
                  <input
                    type="text"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. Production POS / Booking System"
                    className="w-full bg-[#0A1020] border border-[#1C2846] text-white text-xs rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Rate Limit (Requests / Minute)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={rateLimit}
                    onChange={(e) => setRateLimit(Number(e.target.value))}
                    className="w-full bg-[#0A1020] border border-[#1C2846] text-white text-xs rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Limits sliding 1-minute window submissions for this credential.
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer shadow-sm shadow-blue-900/30"
                  >
                    {isSubmitting ? 'Generating...' : 'Create API Key'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false)
                      setErrorMsg(null)
                    }}
                    className="px-3.5 py-2 bg-[#131E38] hover:bg-[#192748] text-slate-300 border border-[#1C2846] text-xs rounded-lg transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-[#0E172B] border border-[#1C2846] rounded-xl overflow-hidden shadow-sm">
            {credentials.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No API credentials issued yet. Generate a key to begin ingesting external completions.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0A1020] text-slate-400 border-b border-[#1C2846] uppercase tracking-wider text-[10px]">
                    <tr>
                      <th scope="col" className="py-3 px-5">Name / ID</th>
                      <th scope="col" className="py-3 px-4">Status</th>
                      <th scope="col" className="py-3 px-4">Rate Limit</th>
                      <th scope="col" className="py-3 px-4">Last Used</th>
                      <th scope="col" className="py-3 px-4">Created</th>
                      {isOwnerOrAdmin && <th scope="col" className="py-3 px-5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C2846]/70">
                    {credentials.map((c) => (
                      <tr key={c.id} className="hover:bg-[#131E38]/40 transition-colors">
                        <td className="py-3.5 px-5">
                          <div className="font-semibold text-white text-xs">{c.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">{c.id}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                              c.status === 'ACTIVE'
                                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80'
                                : 'bg-rose-950/60 text-rose-300 border-rose-800/80'
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 font-mono text-[11px]">
                          {c.rateLimitPerMinute} / min
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                          {c.lastUsedAt
                            ? new Date(c.lastUsedAt).toLocaleString()
                            : 'Never'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        {isOwnerOrAdmin && (
                          <td className="py-3.5 px-5 text-right">
                            {c.status === 'ACTIVE' && (
                              <button
                                onClick={() => handleRevoke(c.id)}
                                className="px-2.5 py-1 text-[11px] font-medium text-rose-400 hover:text-rose-200 hover:bg-rose-950/50 rounded-md border border-rose-900/60 transition cursor-pointer"
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Ingestion Logs */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Recent completion ingestion requests. Payload bodies are not retained for customer privacy.
          </p>
          <div className="bg-[#0E172B] border border-[#1C2846] rounded-xl overflow-hidden shadow-sm">
            {logs.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No ingestion requests recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0A1020] text-slate-400 border-b border-[#1C2846] uppercase tracking-wider text-[10px]">
                    <tr>
                      <th scope="col" className="py-3 px-5">Timestamp</th>
                      <th scope="col" className="py-3 px-4">Status</th>
                      <th scope="col" className="py-3 px-4">Source Event ID</th>
                      <th scope="col" className="py-3 px-4">HTTP</th>
                      <th scope="col" className="py-3 px-4">Error Code</th>
                      <th scope="col" className="py-3 px-5">Body Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C2846]/70 font-mono text-[11px]">
                    {logs.map((log) => {
                      const statusColors: Record<string, string> = {
                        ACCEPTED: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80',
                        DUPLICATE: 'bg-blue-950/60 text-blue-300 border-blue-800/80',
                        CLAIMED: 'bg-amber-950/60 text-amber-300 border-amber-800/80',
                        REJECTED: 'bg-orange-950/60 text-orange-300 border-orange-800/80',
                        FAILED: 'bg-rose-950/60 text-rose-300 border-rose-800/80',
                      }

                      return (
                        <tr key={log.id} className="hover:bg-[#131E38]/40 transition-colors">
                          <td className="py-3.5 px-5 font-sans text-slate-400 text-xs">
                            {new Date(log.requestTimestamp).toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                                statusColors[log.status] || 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-300">
                            {log.sourceEventId || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400">
                            {log.httpStatus || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-amber-400">
                            {log.errorCode || '—'}
                          </td>
                          <td className="py-3.5 px-5 text-slate-500 text-[10px]">
                            {log.requestBodyHash.slice(0, 12)}…
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Integration Guide */}
      {activeTab === 'guide' && (
        <div className="space-y-6 text-xs text-slate-300 max-w-4xl">
          <div className="bg-[#0E172B] border border-[#1C2846] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">Universal Completion API Specification</h3>
            <p className="text-slate-400 leading-relaxed text-xs">
              MPG Reputation accepts customer completion events via signed HTTP POST requests to trigger review request workflows.
            </p>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs">Endpoint</span>
              <div className="bg-[#0A1020] p-2.5 rounded-lg border border-[#1C2846] font-mono text-blue-400 text-xs">
                POST /api/v1/completions
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs">Required Headers</span>
              <div className="bg-[#0A1020] p-3 rounded-lg border border-[#1C2846] font-mono text-[11px] space-y-1.5">
                <div><span className="text-slate-500">Authorization:</span> Bearer mpg_v1.&lt;credential_id&gt;.&lt;secret&gt;</div>
                <div><span className="text-slate-500">X-MPG-Timestamp:</span> &lt;unix_timestamp_seconds&gt;</div>
                <div><span className="text-slate-500">X-MPG-Nonce:</span> &lt;unique_random_nonce_16_chars_plus&gt;</div>
                <div><span className="text-slate-500">X-MPG-Signature:</span> v1=&lt;hmac_sha256_hex&gt;</div>
                <div><span className="text-slate-500">Content-Type:</span> application/json</div>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs">HMAC Signature Formula</span>
              <p className="text-slate-400 text-xs leading-relaxed">
                Compute an HMAC-SHA256 digest using your plaintext API secret over the concatenated string:
              </p>
              <div className="bg-[#0A1020] p-2.5 rounded-lg border border-[#1C2846] font-mono text-emerald-400 text-xs">
                signature = HMAC_SHA256(secret, timestamp + &quot;.&quot; + nonce + &quot;.&quot; + rawBody)
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs">Sample Payload (Synthetic)</span>
              <pre className="bg-[#0A1020] p-3.5 rounded-lg border border-[#1C2846] font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
{`{
  "event_id": "job-2026-09-01",
  "location_id": "YOUR_LOCATION_UUID",
  "completed_at": "2026-09-19T10:00:00Z",
  "country": "CA",
  "customer": {
    "first_name": "Jordan",
    "last_name": "Smith",
    "email": "jordan.smith@example.test",
    "phone": "+15551234567"
  },
  "permission": {
    "email": "allowed",
    "sms": "unknown"
  }
}`}
              </pre>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs">Idempotency & Replays</span>
              <p className="text-slate-400 leading-relaxed text-xs">
                Submissions with the same <code className="text-blue-300">event_id</code> for your organization are strictly idempotent. The first submission returns <code className="text-emerald-400">202 Accepted</code>, and subsequent identical submissions return <code className="text-blue-400">200 OK</code> with <code className="text-slate-300">&quot;duplicate&quot;: true</code> without generating duplicate review requests or mutating customer records. Replayed nonces are rejected with <code className="text-rose-400">409 Conflict</code>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
