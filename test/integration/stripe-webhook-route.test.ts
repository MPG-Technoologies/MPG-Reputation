import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { POST } from '../../src/app/api/webhooks/stripe/route'
import { createStripeClient } from '../../src/lib/billing/stripe'
import { createAdminClient } from '../../src/lib/supabase/admin'

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY

const isDbAvailable =
  !!SERVICE_ROLE_KEY &&
  SERVICE_ROLE_KEY !== 'dummy_service_role_key'

const TEST_STRIPE_SECRET_KEY = 'sk_test_mr5c_route_fixture'
const TEST_WEBHOOK_SECRET = 'whsec_mr5c_route_fixture'

const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET
const originalLiveBilling = process.env.ENABLE_LIVE_BILLING

function restoreEnvironment() {
  if (originalStripeSecretKey === undefined) {
    delete process.env.STRIPE_SECRET_KEY
  } else {
    process.env.STRIPE_SECRET_KEY = originalStripeSecretKey
  }

  if (originalWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
  }

  if (originalLiveBilling === undefined) {
    delete process.env.ENABLE_LIVE_BILLING
  } else {
    process.env.ENABLE_LIVE_BILLING = originalLiveBilling
  }
}

describe.skipIf(!isDbAvailable)(
  'MR-5C Stripe webhook HTTP intake boundary',
  () => {
    let supabase: ReturnType<typeof createAdminClient>

    const prefix = `mr5c-stripe-route-${Date.now()}`

    function makeRawBody(args: {
      id: string
      livemode?: boolean
      marker?: string
    }) {
      const {
        id,
        livemode = false,
        marker = 'original',
      } = args

      return JSON.stringify({
        id,
        object: 'event',
        api_version: null,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: `sub_${marker}`,
            object: 'subscription',
          },
        },
        livemode,
        pending_webhooks: 1,
        request: {
          id: null,
          idempotency_key: null,
        },
        type: 'customer.subscription.updated',
      })
    }

    function createSignedRequest(
      rawBody: string,
      webhookSecret = TEST_WEBHOOK_SECRET
    ) {
      const stripe = createStripeClient()

      const signature =
        stripe.webhooks.generateTestHeaderString({
          payload: rawBody,
          secret: webhookSecret,
        })

      return new Request(
        'http://localhost/api/webhooks/stripe',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': signature,
          },
          body: rawBody,
        }
      )
    }

    async function countEvent(
      providerEventId: string,
      environment: 'TEST' | 'LIVE' = 'TEST'
    ) {
      const { count, error } = await supabase
        .from('billing_webhook_events')
        .select('id', {
          count: 'exact',
          head: true,
        })
        .eq('provider', 'stripe')
        .eq('environment', environment)
        .eq('provider_event_id', providerEventId)

      expect(error).toBeNull()

      return count
    }

    beforeAll(() => {
      supabase = createAdminClient()
    })

    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY =
        TEST_STRIPE_SECRET_KEY

      process.env.STRIPE_WEBHOOK_SECRET =
        TEST_WEBHOOK_SECRET

      delete process.env.ENABLE_LIVE_BILLING
    })

    afterAll(async () => {
      if (supabase) {
        await supabase
          .from('billing_webhook_events')
          .delete()
          .like('provider_event_id', `${prefix}%`)
      }

      restoreEnvironment()
    })

    it('rejects requests without Stripe-Signature before persistence', async () => {
      const id = `${prefix}-missing-signature`
      const rawBody = makeRawBody({ id })

      const response = await POST(
        new Request(
          'http://localhost/api/webhooks/stripe',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: rawBody,
          }
        )
      )

      expect(response.status).toBe(400)
      expect(await countEvent(id)).toBe(0)
    })

    it('rejects a tampered body with an invalid signature', async () => {
      const id = `${prefix}-tampered`

      const signedBody = makeRawBody({
        id,
        marker: 'signed',
      })

      const stripe = createStripeClient()

      const signature =
        stripe.webhooks.generateTestHeaderString({
          payload: signedBody,
          secret: TEST_WEBHOOK_SECRET,
        })

      const tamperedBody = signedBody.replace(
        'sub_signed',
        'sub_tampered'
      )

      const response = await POST(
        new Request(
          'http://localhost/api/webhooks/stripe',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'stripe-signature': signature,
            },
            body: tamperedBody,
          }
        )
      )

      expect(response.status).toBe(400)
      expect(await countEvent(id)).toBe(0)
    })

    it('claims an authentic TEST event and returns 200 quickly', async () => {
      const id = `${prefix}-valid`
      const rawBody = makeRawBody({ id })

      const response = await POST(
        createSignedRequest(rawBody)
      )

      expect(response.status).toBe(200)

      await expect(response.json()).resolves.toEqual({
        received: true,
        claimed: true,
      })

      const { data, error } = await supabase
        .from('billing_webhook_events')
        .select(
          'provider, environment, provider_event_id, event_type, processing_status, processed_at'
        )
        .eq('provider', 'stripe')
        .eq('environment', 'TEST')
        .eq('provider_event_id', id)
        .single()

      expect(error).toBeNull()

      expect(data).toMatchObject({
        provider: 'stripe',
        environment: 'TEST',
        provider_event_id: id,
        event_type: 'customer.subscription.updated',
        processing_status: 'RECEIVED',
        processed_at: null,
      })
    })

    it('acknowledges an exact duplicate without creating another row', async () => {
      const id = `${prefix}-duplicate`
      const rawBody = makeRawBody({ id })

      const firstResponse = await POST(
        createSignedRequest(rawBody)
      )

      const secondResponse = await POST(
        createSignedRequest(rawBody)
      )

      expect(firstResponse.status).toBe(200)
      expect(secondResponse.status).toBe(200)

      await expect(secondResponse.json()).resolves.toEqual({
        received: true,
        duplicate: true,
        final: false,
      })

      expect(await countEvent(id)).toBe(1)
    })

    it('fails closed on an authenticated duplicate payload hash conflict', async () => {
      const id = `${prefix}-payload-conflict`

      const firstBody = makeRawBody({
        id,
        marker: 'first',
      })

      const secondBody = makeRawBody({
        id,
        marker: 'second',
      })

      const firstResponse = await POST(
        createSignedRequest(firstBody)
      )

      const secondResponse = await POST(
        createSignedRequest(secondBody)
      )

      expect(firstResponse.status).toBe(200)
      expect(secondResponse.status).toBe(409)

      await expect(secondResponse.json()).resolves.toEqual({
        received: false,
        conflict: true,
      })

      expect(await countEvent(id)).toBe(1)
    })

    it('rejects verified LIVE events before persistence while live billing is disabled', async () => {
      const id = `${prefix}-live-disabled`

      const rawBody = makeRawBody({
        id,
        livemode: true,
      })

      const response = await POST(
        createSignedRequest(rawBody)
      )

      expect(response.status).toBe(503)
      expect(await countEvent(id, 'LIVE')).toBe(0)
    })

    it('fails closed with 500 when webhook server configuration is incomplete', async () => {
      const id = `${prefix}-missing-config`
      const rawBody = makeRawBody({ id })

      const request = createSignedRequest(rawBody)

      delete process.env.STRIPE_WEBHOOK_SECRET

      const response = await POST(request)

      expect(response.status).toBe(500)
      expect(await countEvent(id)).toBe(0)
    })
  }
)