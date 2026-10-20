import Link from 'next/link'
import { ScopedBusinessNav } from '@/components/workspace/scoped-business-nav'
import { redirect } from 'next/navigation'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { getBillingWorkspaceSummary } from '@/domain/billing/ui-state'
import { createClient } from '@/lib/supabase/server'
import { resolveCurrentServerOrganization } from '@/lib/workspace/server-active-organization'

export const dynamic = 'force-dynamic'

export default async function ScopedBillingPage({
  params,
}: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  // A URL identifier is a proposal, never membership, role, or billing truth.
  const access = await resolveCurrentServerOrganization(organizationId)
  if (access.outcome === 'AUTH_REQUIRED') redirect('/login')
  if (access.outcome !== 'SELECTED') return <PageShell>
    <PageHeader title="Billing unavailable" />
    <p role="alert" className="text-amber-200">
      Business access could not be verified. No billing records were read.
    </p>
  </PageShell>
  if (access.organization.role !== 'OWNER' && access.organization.role !== 'ADMIN') {
    return <PageShell>
      <PageHeader title="Billing unavailable" />
      <p role="alert" className="text-amber-200">
        Owner or administrator access required. No billing records were read.
      </p>
    </PageShell>
  }

  const org = access.organization
  const supabase = await createClient()
  const [
    { data: account, error: accountError },
    { data: subscriptions, error: subscriptionsError },
  ] = await Promise.all([
    supabase.from('organization_billing_accounts')
      .select('id').eq('organization_id', org.organizationId)
      .eq('provider', 'stripe').eq('environment', 'TEST').maybeSingle(),
    supabase.from('organization_subscriptions')
      .select('billing_account_id, normalized_status, current_period_end, cancel_at_period_end, environment')
      .eq('organization_id', org.organizationId)
      .eq('provider', 'stripe').eq('environment', 'TEST')
      .order('created_at', { ascending: false }).limit(2),
  ])
  const ambiguous = (subscriptions?.length ?? 0) > 1
  const mismatch = Boolean(subscriptions?.length &&
    (!account || subscriptions[0].billing_account_id !== account.id))
  const summary = getBillingWorkspaceSummary({
    hasTestAccount: Boolean(account),
    subscription: ambiguous || mismatch ? null : subscriptions?.[0] ?? null,
    dataUnavailable: Boolean(accountError || subscriptionsError ||
      !subscriptions || account === undefined || ambiguous || mismatch),
  })
  return <PageShell>
    <PageHeader title="Billing & subscription"
      subtitle={`${org.organizationName} · TEST billing overview · 30 Free Review Requests`}
      actions={<Link href="/workspace/organizations" className="text-blue-300 underline">
        Change business
      </Link>} />
    <ScopedBusinessNav org={org} current="billing" />
    <Panel className="p-6">
      <h2 className="font-semibold">Subscription status</h2>
      <p role="status" className="mt-3 text-lg font-semibold text-blue-200">{summary.headline}</p>
      <p className="mt-2 text-sm text-slate-300">{summary.description}</p>
      <p className="mt-3 text-sm text-slate-400">
        {summary.status === 'UNAVAILABLE'
          ? 'TEST billing account could not be verified.'
          : account ? 'A TEST account is linked to this business.'
            : 'No TEST payment account is linked to this business.'}
      </p>
      {summary.periodEnd && <p className="mt-3 text-sm text-slate-400">
        Recorded period end: {new Date(summary.periodEnd).toISOString().slice(0, 10)} UTC
      </p>}
    </Panel>
    <p className="mt-5 text-sm text-amber-200">
      Read-only engineering view. A TEST provider state does not prove invoice settlement.
      Payment checkout, prices, portal actions and paid access remain disabled.
    </p>
  </PageShell>
}
