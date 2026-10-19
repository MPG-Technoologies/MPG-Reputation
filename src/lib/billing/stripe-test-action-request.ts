import 'server-only'

export type LocalTestBillingAction =
  | { readonly action: 'CUSTOMER_SETUP' | 'PORTAL'; readonly organizationId: string }
  | { readonly action: 'CHECKOUT'; readonly organizationId: string; readonly planId: 'monthly' | 'annual' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLocalTestBillingActionEndpointEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS === 'true' &&
    process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET === 'LOCAL_SYNTHETIC' &&
    ['http://127.0.0.1:54331','http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}

/**
 * Refuse all unrecognized client fields. A browser can select an existing
 * organization and known plan, but never a provider Customer/Price ID,
 * destination URL, arbitrary amount, user ID, admin claim or promotion.
 */
export function parseLocalTestBillingAction(input: unknown): LocalTestBillingAction | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const body = input as Record<string, unknown>
  const { action, organizationId } = body
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return null
  if (action !== 'CUSTOMER_SETUP' && action !== 'CHECKOUT' && action !== 'PORTAL') {
    return null
  }
  const allowedKeys = action === 'CHECKOUT'
    ? ['action','organizationId','planId'] : ['action','organizationId']
  if (Object.keys(body).length !== allowedKeys.length ||
      !Object.keys(body).every(key => allowedKeys.includes(key))) return null

  if (action === 'CHECKOUT') {
    if (body.planId !== 'monthly' && body.planId !== 'annual') return null
    return { action, organizationId, planId: body.planId }
  }
  return { action, organizationId }
}
