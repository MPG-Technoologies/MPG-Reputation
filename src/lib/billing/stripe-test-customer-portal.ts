import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getStripeTestCheckoutReturnOrigin } from './stripe-test-checkout-start'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/
const CONFIG_ID = /^bpc_[A-Za-z0-9]+$/
const SESSION_ID = /^bps_[A-Za-z0-9]+$/

export interface StripeTestPortalConfiguration {
  readonly id: string
  readonly livemode: boolean
  readonly active: boolean
  readonly features: {
    readonly invoiceHistoryEnabled: boolean
    readonly paymentMethodUpdateEnabled: boolean
    readonly subscriptionUpdateEnabled: boolean
    readonly subscriptionCancelEnabled: boolean
    readonly customerUpdateEnabled: boolean
  }
  readonly loginPageEnabled: boolean
}

export interface StripeTestPortalSession {
  readonly id: string
  readonly livemode: boolean
  readonly customer: string
  readonly configuration: string
  readonly returnUrl: string
  readonly url: string
}

export type StripeTestPortalResult =
  | { readonly outcome: 'DISABLED' }
  | { readonly outcome: 'BLOCKED'; readonly reason:
    | 'NOT_AUTHENTICATED' | 'INVALID_ORGANIZATION' | 'NOT_AUTHORIZED'
    | 'ACCOUNT_SETUP_REQUIRED' | 'PORTAL_NOT_CONFIGURED'
    | 'PORTAL_CONFIGURATION_UNSAFE' | 'PROVIDER_UNAVAILABLE' | 'SESSION_INVALID' }
  | { readonly outcome: 'READY'; readonly portalUrl: string }

/** A portal URL is a bearer capability. Do not persist or log it. */
export function isSafeStripeTestPortalUrl(value: string): boolean {
  if (!value || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'billing.stripe.com' &&
      url.port === '' && url.username === '' && url.password === '' &&
      url.pathname.startsWith('/p/session/test_') &&
      url.pathname.length > '/p/session/test_'.length &&
      url.search === '' && url.hash === ''
  } catch {
    return false
  }
}

/**
 * Strictly synthetic-local engineering entry point; there is deliberately NO
 * HTTP handler and no service-role client constructed here. A real deployed
 * TEST portal needs separate owner approval and a request-rate-limit/CSRF gate.
 */
export async function prepareStripeTestPortalSession(args: {
  userSupabase: SupabaseClient<Database>
  organizationId: unknown
  retrieveConfiguration: (id: string) => Promise<StripeTestPortalConfiguration>
  createSession: (input: {
    customerId: string
    configurationId: string
    returnUrl: string
  }) => Promise<StripeTestPortalSession>
}): Promise<StripeTestPortalResult> {
  if (process.env.ENABLE_STRIPE_TEST_PORTAL !== 'true' ||
      process.env.MPG_STRIPE_TEST_PORTAL_TARGET !== 'LOCAL_SYNTHETIC' ||
      process.env.ENABLE_LIVE_BILLING === 'true' ||
      process.env.NODE_ENV === 'production' ||
      process.env.VERCEL_ENV !== undefined ||
      !['http://127.0.0.1:54331', 'http://localhost:54331']
        .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
    return { outcome: 'DISABLED' }
  }

  const { data: auth, error: authError } = await args.userSupabase.auth.getUser()
  if (authError || !auth.user?.id || auth.user.is_anonymous === true || !UUID.test(auth.user.id)) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHENTICATED' }
  }
  if (typeof args.organizationId !== 'string' || !UUID.test(args.organizationId)) {
    return { outcome: 'BLOCKED', reason: 'INVALID_ORGANIZATION' }
  }

  // A RLS-scoped caller must also hold billing-management authority.
  const { data: allowed, error: roleError } = await args.userSupabase.rpc(
    'user_has_role',
    { org_id: args.organizationId, allowed_roles: ['OWNER', 'ADMIN'] }
  )
  if (roleError || allowed !== true) {
    return { outcome: 'BLOCKED', reason: 'NOT_AUTHORIZED' }
  }

  const { data: account, error: accountError } = await args.userSupabase
    .from('organization_billing_accounts')
    .select('provider_customer_id')
    .eq('organization_id', args.organizationId)
    .eq('provider', 'stripe')
    .eq('environment', 'TEST')
    .maybeSingle()
  if (accountError) throw new Error('BILLING_PORTAL_ACCOUNT_LOOKUP_FAILED')
  if (!account || !CUSTOMER_ID.test(account.provider_customer_id)) {
    return { outcome: 'BLOCKED', reason: 'ACCOUNT_SETUP_REQUIRED' }
  }

  const configId = process.env.STRIPE_TEST_PORTAL_CONFIGURATION_ID
  if (!configId || !CONFIG_ID.test(configId)) {
    return { outcome: 'BLOCKED', reason: 'PORTAL_NOT_CONFIGURED' }
  }

  // Portal feature configuration is a security/operating decision. Do not
  // silently inherit Stripe dashboard defaults (which may allow cancellation,
  // subscription upgrades, arbitrary customer edits or public login).
  let config: StripeTestPortalConfiguration
  try { config = await args.retrieveConfiguration(configId) }
  catch { return { outcome: 'BLOCKED', reason: 'PROVIDER_UNAVAILABLE' } }

  if (!config || config.id !== configId ||
      config.livemode !== false || config.active !== true ||
      config.loginPageEnabled !== false ||
      config.features?.invoiceHistoryEnabled !== true ||
      config.features.paymentMethodUpdateEnabled !== true ||
      config.features.subscriptionUpdateEnabled !== false ||
      config.features.subscriptionCancelEnabled !== false ||
      config.features.customerUpdateEnabled !== false) {
    return { outcome: 'BLOCKED', reason: 'PORTAL_CONFIGURATION_UNSAFE' }
  }

  // This origin is a controlled server environment value, not a query string
  // or arbitrary browser redirect. Reuse the existing Checkout origin validator.
  const returnUrl = getStripeTestCheckoutReturnOrigin() + '/app/settings/billing'
  let session: StripeTestPortalSession
  try {
    session = await args.createSession({
      customerId: account.provider_customer_id,
      configurationId: configId,
      returnUrl,
    })
  } catch {
    return { outcome: 'BLOCKED', reason: 'PROVIDER_UNAVAILABLE' }
  }

  if (!session || !SESSION_ID.test(session.id) ||
      session.livemode !== false ||
      session.customer !== account.provider_customer_id ||
      session.configuration !== configId ||
      session.returnUrl !== returnUrl ||
      typeof session.url !== 'string' ||
      !isSafeStripeTestPortalUrl(session.url)) {
    return { outcome: 'BLOCKED', reason: 'SESSION_INVALID' }
  }

  return { outcome: 'READY', portalUrl: session.url }
}
