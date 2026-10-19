import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createClient as createUserClient } from '@/lib/supabase/server'
import {
  admitStripeTestBillingAction,
} from '@/lib/billing/stripe-test-billing-action-admission'
import {
  isLocalTestBillingActionEndpointEnabled,
  parseLocalTestBillingAction,
} from '@/lib/billing/stripe-test-action-request'
import { provisionStripeTestCustomer } from '@/lib/billing/stripe-test-customer-provisioning'
import { createStripeTestCustomerCreator } from '@/lib/billing/stripe-test-customer-provider'
import { startStripeTestCheckout } from '@/lib/billing/stripe-test-checkout-start'
import { createStripeTestCheckoutPriceRetriever } from '@/lib/billing/stripe-test-checkout-price'
import { createStripeTestCheckoutSessionCreator } from '@/lib/billing/stripe-test-checkout-session'
import { prepareStripeTestPortalSession } from '@/lib/billing/stripe-test-customer-portal'
import { createStripeTestPortalProvider } from '@/lib/billing/stripe-test-portal-provider'

export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

/** Read at most 1024 bytes, even if the sender omits Content-Length. */
async function readSmallBody(req: NextRequest): Promise<string | null> {
  if (!req.body) return null
  const reader = req.body.getReader()
  const fragments: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > 1024) {
        await reader.cancel()
        return null
      }
      fragments.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!total) return null
  const bytes = new Uint8Array(total)
  let pos = 0
  for (const fragment of fragments) {
    bytes.set(fragment, pos)
    pos += fragment.length
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return null }
}

/**
 * This HTTP route is present only as an inert engineering integration.
 * In production / preview / hosted environments it hard-blocks BEFORE
 * touching cookies, Supabase credentials, provider clients or request data.
 */
export async function POST(req: NextRequest) {
  if (!isLocalTestBillingActionEndpointEnabled()) return reply({ outcome: 'DISABLED' }, 404)

  let input: unknown
  try {
    const raw = await readSmallBody(req)
    if (!raw) return reply({ outcome: 'INVALID_REQUEST' }, 400)
    input = JSON.parse(raw)
  } catch {
    return reply({ outcome: 'INVALID_REQUEST' }, 400)
  }

  const parsed = parseLocalTestBillingAction(input)
  if (!parsed) return reply({ outcome: 'INVALID_REQUEST' }, 400)

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) return reply({ outcome: 'DISABLED' }, 404)

  const userSupabase = await createUserClient()
  const privilegedSupabase = createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const admission = await admitStripeTestBillingAction({
      userSupabase,
      trustedBillingSupabase: privilegedSupabase,
      organizationId: parsed.organizationId,
      action: parsed.action,
      request: {
        method: req.method,
        origin: req.headers.get('origin'),
        fetchSite: req.headers.get('sec-fetch-site'),
        fetchMode: req.headers.get('sec-fetch-mode'),
        contentType: req.headers.get('content-type'),
        actionHeader: req.headers.get('x-mpg-billing-action'),
      },
    })
    if (admission.outcome === 'DISABLED') return reply({ outcome: 'DISABLED' }, 404)
    if (admission.outcome === 'DENIED') {
      return reply({ outcome: 'DENIED', reason: admission.reason },
        admission.reason === 'NOT_AUTHENTICATED' ? 401 :
          admission.reason === 'RATE_LIMITED' ? 429 : 403)
    }

    if (parsed.action === 'CUSTOMER_SETUP') {
      const result = await provisionStripeTestCustomer({
        userSupabase,
        trustedBillingSupabase: privilegedSupabase,
        organizationId: parsed.organizationId,
        createCustomer: createStripeTestCustomerCreator(),
      })
      if (result.outcome === 'READY') {
        return reply({ outcome: 'READY', alreadyLinked: result.alreadyLinked })
      }
      return reply({ outcome: result.outcome }, 409)
    }

    if (parsed.action === 'CHECKOUT') {
      const result = await startStripeTestCheckout({
        userSupabase,
        trustedBillingSupabase: privilegedSupabase,
        organizationId: parsed.organizationId,
        planId: parsed.planId,
        retrievePrice: createStripeTestCheckoutPriceRetriever(),
        createSession: createStripeTestCheckoutSessionCreator(),
      })
      if (result.outcome === 'READY') {
        return reply({ outcome: 'READY', redirectUrl: result.sessionUrl })
      }
      return reply({ outcome: result.outcome }, 409)
    }

    const provider = createStripeTestPortalProvider()
    const result = await prepareStripeTestPortalSession({
      userSupabase,
      organizationId: parsed.organizationId,
      retrieveConfiguration: provider.retrieveConfiguration,
      createSession: provider.createSession,
    })
    if (result.outcome === 'READY') {
      return reply({ outcome: 'READY', redirectUrl: result.portalUrl })
    }
    return reply({ outcome: result.outcome }, 409)
  } catch {
    // No secret, provider exception, service-role key or PII in HTTP errors.
    return reply({ outcome: 'TEMPORARILY_UNAVAILABLE' }, 503)
  }
}

export async function OPTIONS() {
  return reply({ outcome: 'DISABLED' }, 405)
}
