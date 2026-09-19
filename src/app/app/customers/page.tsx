import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { TablePanel, EmptyState } from '@/components/layout/panels'
import { UsersIcon, SearchIcon, MapPinIcon } from '@/components/ui/icons'
import { RecordCompletionButton } from './customer-actions'

interface CustomersPageProps {
  searchParams: Promise<{
    page?: string
    q?: string
  }>
}

const PAGE_SIZE = 15

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const { page = '1', q = '' } = await searchParams
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: memberships } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id)

  const activeMembership = memberships?.[0]
  const orgId = activeMembership?.organization_id

  if (!orgId) {
    redirect('/onboarding')
  }

  // Authoritative tenant customer query with pagination and optional search filter
  let query = supabase
    .from('customers')
    .select('id, location_id, first_name, last_name, email, phone, permission_email, created_at', {
      count: 'exact',
    })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (q.trim()) {
    query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
  }

  const [{ data: customers, count = 0 }, { data: locations }] = await Promise.all([
    query,
    supabase.from('locations').select('id, name').eq('organization_id', orgId),
  ])

  const locationMap = new Map((locations || []).map((loc) => [loc.id, loc.name]))
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  return (
    <PageShell>
      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <UsersIcon className="w-5 h-5 text-blue-400" />
            <span>Customers</span>
          </span>
        }
        subtitle="Recorded customer completion history and review invitation permissions across all locations."
        actions={<RecordCompletionButton label="Record Completion" />}
      />

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mb-4">
        <form method="GET" className="relative w-full sm:w-80">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by name or email…"
            className="w-full bg-[#0E172B] border border-[#1C2846] rounded-lg pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </form>

        <div className="text-xs text-slate-400 self-end sm:self-center">
          Showing <span className="font-semibold text-white">{customers?.length ?? 0}</span> of{' '}
          <span className="font-semibold text-white">{count ?? 0}</span> customers
        </div>
      </div>

      {/* Operational Customer Workspace */}
      {!customers || customers.length === 0 ? (
        <TablePanel>
          <EmptyState
            icon={UsersIcon}
            title="No customers found"
            description={
              q
                ? 'No customer records matched your search query. Try clearing the filter.'
                : 'Customer records are created when service completions are submitted via Quick Complete or API integrations.'
            }
            action={<RecordCompletionButton label="Record First Completion" variant="secondary" />}
          />
        </TablePanel>
      ) : (
        <TablePanel
          footer={
            <>
              <Link
                href={`/app/customers?page=${currentPage - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                className={`px-3 py-1.5 rounded-md border border-[#1C2846] ${
                  currentPage <= 1
                    ? 'pointer-events-none opacity-40 text-slate-600 bg-transparent'
                    : 'hover:bg-[#131E38] text-slate-200 transition-colors'
                }`}
                aria-disabled={currentPage <= 1}
              >
                Previous
              </Link>

              <span>
                Page <span className="font-bold text-white">{currentPage}</span> of{' '}
                <span className="font-bold text-white">{totalPages}</span>
              </span>

              <Link
                href={`/app/customers?page=${currentPage + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                className={`px-3 py-1.5 rounded-md border border-[#1C2846] ${
                  currentPage >= totalPages
                    ? 'pointer-events-none opacity-40 text-slate-600 bg-transparent'
                    : 'hover:bg-[#131E38] text-slate-200 transition-colors'
                }`}
                aria-disabled={currentPage >= totalPages}
              >
                Next
              </Link>
            </>
          }
        >
          {/* ========================================================== */}
          {/* DESKTOP & TABLET TABLE (>= 768px)                           */}
          {/* ========================================================== */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0A1020] text-slate-400 uppercase tracking-wider text-[10px] border-b border-[#1C2846] sticky top-0 z-10">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Customer Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Location</th>
                  <th scope="col" className="px-3 py-3 font-medium">Consent</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2846]/70">
                {customers.map((c) => {
                  const locationName = locationMap.get(c.location_id) || 'Primary Location'
                  const fullName = `${c.first_name} ${c.last_name || ''}`.trim()
                  const createdDate = new Date(c.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })

                  return (
                    <tr key={c.id} className="hover:bg-[#131E38]/50 transition-colors">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="font-semibold text-white text-xs">{fullName}</div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                        {c.email || <span className="text-slate-600 font-sans">—</span>}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                          <MapPinIcon className="w-3 h-3 text-slate-500" />
                          <span>{locationName}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <span
                          className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${
                            c.permission_email === 'allowed'
                              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
                              : c.permission_email === 'denied'
                              ? 'bg-rose-950/60 text-rose-300 border-rose-800/80'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {c.permission_email}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-slate-400 text-[11px] text-right font-mono">
                        {createdDate}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ========================================================== */}
          {/* MOBILE CARDS (< 768px)                                      */}
          {/* ========================================================== */}
          <div className="md:hidden divide-y divide-[#1C2846]">
            {customers.map((c) => {
              const locationName = locationMap.get(c.location_id) || 'Primary Location'
              const fullName = `${c.first_name} ${c.last_name || ''}`.trim()
              const createdDate = new Date(c.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })

              return (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-white text-sm">{fullName}</div>
                      <div className="text-xs text-slate-400 mt-0.5 font-mono">
                        {c.email || 'No email provided'}
                      </div>
                    </div>
                    <span
                      className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded border ${
                        c.permission_email === 'allowed'
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
                          : c.permission_email === 'denied'
                          ? 'bg-rose-950/60 text-rose-300 border-rose-800/80'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {c.permission_email}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-[#1C2846]/60">
                    <span className="flex items-center gap-1">
                      <MapPinIcon className="w-3 h-3 text-slate-500" />
                      <span>{locationName}</span>
                    </span>
                    <span className="font-mono text-[11px]">{createdDate}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </TablePanel>
      )}
    </PageShell>
  )
}
