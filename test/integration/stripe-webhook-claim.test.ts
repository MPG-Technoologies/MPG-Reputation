import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import {
  claimVerifiedStripeWebhookEvent,
  hashStripeWebhookPayload,
} from '../../src/lib/billing/stripe-webhook-store'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY

const isDbAvailable =
  !!SERVICE_ROLE_KEY &&
  SERVICE_ROLE_KEY !== 'dummy_service_role_key'

const originalLiveBilling = process.env.ENABLE_LIVE_BILLING

function restoreLiveBilling() {
  if (originalLiveBilling === undefined) {
    delete process.env.ENABLE_LIVE_BILLING
  } else {
    process.env.ENABLE_LIVE_BILLING = originalLiveBilling
  }
}

describe.skipIf(!isDbAvailable)(
  'MR-5C Stripe webhook durable event claim',
  () => {
    let adminClient: ReturnType<typeof createClient<Database>>
    const prefix = `mr5c-stripe-claim-${Date.now()}`

    function makeEvent(
      id: string,
      livemode = false
    ) {
      return {
        id,
        type: 'customer.subscription.updated' as const,
        created: Math.floor(Date.now() / 1000),
        livemode,
      }
    }

    function makeBody(
      id: string,
      livemode = false,
      marker = 'original'
    ) {
      return JSON.stringify({
        id,
        object: 'event',
        type: 'customer.subscription.updated' as const,
        created: Math.floor(Date.now() / 1000),
        livemode,
        data: {
          object: {
            id: `sub_${marker}`,
            object: 'subscription',
          },
        },
        marker,
      })
    }

    beforeAll(() => {
      adminClient = createClient<Database>(
        SUPABASE_URL,
        SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      )
    })

    afterEach(() => {
      restoreLiveBilling()
    })

    afterAll(async () => {
      if (adminClient) {
        await adminClient
          .from('billing_webhook_events')
          .delete()
          .like('provider_event_id', `${prefix}%`)
      }
    })

    it('produces a stable SHA-256 payload hash', () => {
      const first = hashStripeWebhookPayload('{"hello":"world"}')
      const second = hashStripeWebhookPayload('{"hello":"world"}')

      expect(first).toBe(second)
      expect(first).toMatch(/^[a-f0-9]{64}$/)
    })

    it('atomically claims a new verified TEST event as RECEIVED', async () => {
      const id = `${prefix}-new`
      const body = makeBody(id)

      const result = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: body,
      })

      expect(result.outcome).toBe('CLAIMED')
      expect(result.environment).toBe('TEST')
      expect(result.processingStatus).toBe('RECEIVED')
      expect(result.organizationId).toBeNull()
      expect(result.payloadHash).toBe(
        hashStripeWebhookPayload(body)
      )

      const { data, error } = await adminClient
        .from('billing_webhook_events')
        .select(
          'provider, environment, provider_event_id, processing_status, payload_hash'
        )
        .eq('provider', 'stripe')
        .eq('environment', 'TEST')
        .eq('provider_event_id', id)
        .single()

      expect(error).toBeNull()
      expect(data?.provider).toBe('stripe')
      expect(data?.environment).toBe('TEST')
      expect(data?.provider_event_id).toBe(id)
      expect(data?.processing_status).toBe('RECEIVED')
      expect(data?.payload_hash).toBe(
        hashStripeWebhookPayload(body)
      )
    })

    it('returns EXISTING_INCOMPLETE for an exact duplicate that is not finalized', async () => {
      const id = `${prefix}-duplicate`
      const body = makeBody(id)

      const first = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: body,
      })

      const second = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: body,
      })

      expect(first.outcome).toBe('CLAIMED')
      expect(second.outcome).toBe('EXISTING_INCOMPLETE')
      expect(second.recordId).toBe(first.recordId)
      expect(second.processingStatus).toBe('RECEIVED')
    })

    it('detects the same provider event id with a different authenticated payload hash', async () => {
      const id = `${prefix}-payload-conflict`

      const firstBody = makeBody(id, false, 'first')
      const conflictingBody = makeBody(id, false, 'second')

      const first = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: firstBody,
      })

      const second = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: conflictingBody,
      })

      expect(first.outcome).toBe('CLAIMED')
      expect(second.outcome).toBe('PAYLOAD_CONFLICT')
      expect(second.recordId).toBe(first.recordId)
      expect(second.payloadHash).toBe(
        hashStripeWebhookPayload(firstBody)
      )
    })

    it('uses the unique constraint as the concurrency-safe claim primitive', async () => {
      const id = `${prefix}-concurrent`
      const body = makeBody(id)

      const [first, second] = await Promise.all([
        claimVerifiedStripeWebhookEvent({
          supabase: adminClient,
          event: makeEvent(id),
          rawBody: body,
        }),
        claimVerifiedStripeWebhookEvent({
          supabase: adminClient,
          event: makeEvent(id),
          rawBody: body,
        }),
      ])

      const outcomes = [first.outcome, second.outcome].sort()

      expect(outcomes).toEqual(
        ['CLAIMED', 'EXISTING_INCOMPLETE'].sort()
      )
      expect(first.recordId).toBe(second.recordId)
    })

    it('returns EXISTING_FINAL after the claimed event is durably processed', async () => {
      const id = `${prefix}-final`
      const body = makeBody(id)

      const first = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: body,
      })

      expect(first.outcome).toBe('CLAIMED')

      const { error: updateError } = await adminClient
        .from('billing_webhook_events')
        .update({
          processing_status: 'PROCESSED',
          processed_at: new Date().toISOString(),
        })
        .eq('id', first.recordId)

      expect(updateError).toBeNull()

      const second = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id),
        rawBody: body,
      })

      expect(second.outcome).toBe('EXISTING_FINAL')
      expect(second.processingStatus).toBe('PROCESSED')
      expect(second.recordId).toBe(first.recordId)
    })

    it('keeps identical provider event ids isolated between TEST and LIVE', async () => {
      const id = `${prefix}-environment`

      const testResult = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id, false),
        rawBody: makeBody(id, false, 'test'),
      })

      process.env.ENABLE_LIVE_BILLING = 'true'

      const liveResult = await claimVerifiedStripeWebhookEvent({
        supabase: adminClient,
        event: makeEvent(id, true),
        rawBody: makeBody(id, true, 'live'),
      })

      expect(testResult.outcome).toBe('CLAIMED')
      expect(testResult.environment).toBe('TEST')
      expect(liveResult.outcome).toBe('CLAIMED')
      expect(liveResult.environment).toBe('LIVE')

      const { data, error } = await adminClient
        .from('billing_webhook_events')
        .select('environment')
        .eq('provider', 'stripe')
        .eq('provider_event_id', id)

      expect(error).toBeNull()
      expect(
        data?.map((row) => row.environment).sort()
      ).toEqual(['LIVE', 'TEST'])
    })

    it('rejects LIVE events before persistence when live billing is disabled', async () => {
      const id = `${prefix}-live-disabled`

      delete process.env.ENABLE_LIVE_BILLING

      await expect(
        claimVerifiedStripeWebhookEvent({
          supabase: adminClient,
          event: makeEvent(id, true),
          rawBody: makeBody(id, true),
        })
      ).rejects.toThrow('Live Stripe billing is disabled.')

      const { count, error } = await adminClient
        .from('billing_webhook_events')
        .select('id', { count: 'exact', head: true })
        .eq('provider', 'stripe')
        .eq('environment', 'LIVE')
        .eq('provider_event_id', id)

      expect(error).toBeNull()
      expect(count).toBe(0)
    })
  }
)