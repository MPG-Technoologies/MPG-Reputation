import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader, PageShell } from '@/components/layout/page-shell'
import { Panel } from '@/components/layout/panels'
import { createClient } from '@/lib/supabase/server'
import { getConfiguredReputationBillingCatalog } from '@/lib/billing/pricing'
import { getBillingWorkspaceSummary } from '@/domain/billing/ui-state'
import { selectSingleBillingMembership } from '@/domain/billing/workspace-organization-selection'
import { BillingPlanPreview } from './plan-preview'
import { isLocalTestBillingActionEndpointEnabled } from '@/lib/billing/stripe-test-action-request'

/**
 * Read-only TEST billing workspace. Never trusts an organization ID from URL
 * parameters or selects an arbitrary first membership. With no established
 * active-organization switcher, refuse multi-organization billing context.
 * No checkout server action/portal, Stripe secret or paid entitlement.
 */
export default async function BillingSettingsPage() {
  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user || auth.user.is_anonymous) redirect('/login')

  const { data: memberships, error: membershipError } = await supabase
    .from('organization_users')
    .select('organization_id, role, organizations(name)')
    .eq('user_id', auth.user.id)
  if (membershipError) {
    return <PageShell><p role="alert" className="text-rose-300">Billing access could not be verified. Try again later.</p></PageShell>
  }
  const selection = selectSingleBillingMembership(memberships?.map(membership => ({
    organizationId: membership.organization_id,
    role: membership.role,
    organizationName: (membership.organizations as { name?: string } | null)?.name,
  })))
  if (selection.outcome === 'NO_MEMBERSHIP') redirect('/onboarding')

  // The general app shell still defaults to its first membership. Billing
  // must not inherit that ambiguous context when multiple businesses exist.
  // Do not read any account/subscription or render TEST billing action props.
  if (selection.outcome === 'AMBIGUOUS_ORGANIZATION') {
    return (
      <PageShell>
        <PageHeader title="Billing" subtitle="Select a business before managing its billing." />
        <Panel className="p-6">
          <h2 className="font-semibold text-white">Multiple businesses detected</h2>
          <p role="alert" className="mt-2 text-sm text-amber-200">
            Billing is unavailable in the legacy workspace until you choose a business.
            No billing details or payment actions are shown for an arbitrary business.
          </p>
          <Link href="/workspace/organizations"
            className="mt-4 inline-block text-sm text-blue-300 hover:text-white underline">
            Choose a business
          </Link>
          <p className="mt-3 text-sm text-slate-400">
            The scoped business overview is read-only. Subscription changes and payments remain disabled.
          </p>
        </Panel>
      </PageShell>
    )
  }
  if (selection.outcome === 'INVALID_MEMBERSHIP') {
    return <PageShell><p role="alert" className="text-rose-300">
      Billing organization could not be verified. No billing records were accessed.
    </p></PageShell>
  }

  // Keep the billing view narrower than organization-wide operational reads.
  if (selection.outcome === 'ROLE_RESTRICTED') {
    return (
      <PageShell>
        <PageHeader title="Billing" subtitle="Subscription and payment administration." />
        <Panel className="p-6">
          <h2 className="font-semibold text-white">Owner or administrator access required</h2>
          <p className="mt-2 text-sm text-slate-400">
            Only your business owner or an authorized administrator can review billing details.
          </p>
          <Link href="/app/settings/usage" className="inline-block mt-4 text-blue-400 hover:underline text-sm">
            View your usage and trial instead
          </Link>
        </Panel>
      </PageShell>
    )
  }

  const orgId = selection.organizationId
  const [
    { data: account, error: accountError },
    { data: subscriptions, error: subscriptionsError },
  ] = await Promise.all([
    supabase.from('organization_billing_accounts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('provider', 'stripe')
      .eq('environment', 'TEST')
      .maybeSingle(),
    supabase.from('organization_subscriptions')
      .select('billing_account_id, normalized_status, current_period_end, cancel_at_period_end, environment')
      .eq('organization_id', orgId)
      .eq('provider', 'stripe')
      .eq('environment', 'TEST')
      .order('created_at', { ascending: false })
      .limit(2),
  ])

  // Never silently select the newest of multiple subscription identities.
  // The sole TEST subscription must belong to the same linked billing account.
  const ambiguousSubscriptions = (subscriptions?.length ?? 0) > 1
  const subscriptionAccountMismatch = Boolean(subscriptions?.length &&
    (!account || subscriptions[0].billing_account_id !== account.id))
  const summary = getBillingWorkspaceSummary({
    hasTestAccount: Boolean(account),
    subscription: ambiguousSubscriptions || subscriptionAccountMismatch
      ? null : subscriptions?.[0] ?? null,
    dataUnavailable: Boolean(accountError || subscriptionsError || !subscriptions ||
      account === undefined || ambiguousSubscriptions || subscriptionAccountMismatch),
  })
  // Pricing is *not approved for publication*. Rendering proposed amounts
  // requires explicit local-only opt-in; production cannot override this.
  const pricingPreviewEnabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_MR5D_BILLING_UI_PREVIEW === 'true'
  const catalog = pricingPreviewEnabled ? getConfiguredReputationBillingCatalog() : null
  // This is a read-only production page regardless of feature flags.
  // Interactive billing actions require explicit local-only synthetic gates.
  const localActionsEnabled = pricingPreviewEnabled &&
    summary.status !== 'UNAVAILABLE' && isLocalTestBillingActionEndpointEnabled()

  const name = selection.organizationName

  return (
    <PageShell>
      <PageHeader
        title="Billing & subscription"
        subtitle={`Review ${name}'s billing setup, TEST subscription status and your 30 Free Review Requests trial.`}
        actions={<Link href="/app/settings/usage" className="text-sm text-blue-300 hover:text-white border border-[#2A3A62] px-3 py-2 rounded-lg">
          Usage &amp; Trial
        </Link>}
      />

      <div className="max-w-5xl w-full space-y-5">
        <div className="flex items-center gap-2 text-xs text-amber-200 bg-amber-950/30 border border-amber-900/50 px-4 py-3 rounded-xl">
          <span className="font-semibold">Engineering preview</span>
          <span className="text-amber-100/75">Payments, checkout, and subscription changes are not enabled.</span>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <Panel className="p-6">
            <h2 className="font-semibold text-white text-base">Subscription status</h2>
            <div role="status" className="mt-4 text-lg font-semibold text-blue-200">{summary.headline}</div>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">{summary.description}</p>
            {summary.periodEnd && (
              <p className="mt-3 text-xs text-slate-400">
                Recorded period end: {new Date(summary.periodEnd).toLocaleDateString('en-PH', {
                  year: 'numeric', month: 'short', day: 'numeric',
                  timeZone: 'UTC',
                })}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-4">
              Source: server-read Stripe TEST subscription record. This is not proof of a settled payment.
            </p>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold text-white text-base">Payment account setup</h2>
            <p className="mt-3 text-sm text-slate-300">
              {summary.status === 'UNAVAILABLE'
                ? 'Account status cannot be verified right now.'
                : account
                  ? 'A TEST billing account is linked to this organization.'
                  : 'A Stripe TEST billing account has not been linked to this business.'}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              {summary.status === 'UNAVAILABLE'
                ? 'No TEST payment action is available until the billing records can be verified.'
                : account
                  ? 'Automated payment changes and the customer portal will become available after TEST integration is approved.'
                  : 'A secure account provisioning step is required before subscription checkout. Automatic provisioning is being developed; no manual payment details are needed here.'}
            </p>
            <div className="mt-5 border-t border-[#1C2846] pt-4 text-xs text-slate-400">
              Need help with billing setup? Contact MPG support through your usual business support channel.
            </div>
          </Panel>
        </div>

        <Panel className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-white text-lg">Choose a subscription plan</h2>
            <span className="text-xs border border-[#2A3A62] rounded-full px-3 py-1 text-slate-400">
              Preview only
            </span>
          </div>
          <p className="mt-2 mb-5 text-sm text-slate-400">
            Plans are not yet a published commercial offer. Your free trial remains
            separate from payment setup.
          </p>
          {catalog ? (
            <BillingPlanPreview
              plans={[catalog.monthly, catalog.annual]}
              organizationId={orgId}
              localActionsEnabled={localActionsEnabled}
              hasTestAccount={Boolean(account)}
              hasOngoingSubscription={Boolean(subscriptions?.[0] &&
                subscriptions[0].normalized_status !== 'ENDED')}
            />
          ) : (
            <div className="rounded-xl bg-[#131E38] border border-[#1C2846] p-5">
              <p className="font-medium text-slate-200">Plan selection is not available yet</p>
              <p className="text-sm text-slate-400 mt-1">
                Commercial pricing and checkout remain hidden until approved. There is no payment action to take.
              </p>
            </div>
          )}
        </Panel>

        <Panel className="p-6">
          <h2 className="font-semibold text-white">Subscription management</h2>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Payment history, invoices, updating a payment method, plan changes and cancellation
            will be managed through a secured provider customer portal once integration is approved.
            No billing portal or cancellation action has been activated.
          </p>
          <Link href="/app/settings/usage"
            className="inline-flex mt-4 items-center text-sm font-medium text-blue-300 hover:text-blue-200">
            See 30 Free Review Requests usage →
          </Link>
        </Panel>
      </div>
    </PageShell>
  )
}
