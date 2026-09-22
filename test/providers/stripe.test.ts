import { afterEach, describe, expect, it } from 'vitest'
import Stripe from 'stripe'
import {
  assertStripeEventEnvironmentAllowed,
  billingEnvironmentFromVerifiedStripeEvent,
  createStripeClient,
  getStripeWebhookSecret,
  verifyStripeWebhookEvent,
} from '../../src/lib/billing/stripe'

const originalSecretKey = process.env.STRIPE_SECRET_KEY
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET
const originalLiveBilling = process.env.ENABLE_LIVE_BILLING

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

afterEach(() => {
  restoreEnv('STRIPE_SECRET_KEY', originalSecretKey)
  restoreEnv('STRIPE_WEBHOOK_SECRET', originalWebhookSecret)
  restoreEnv('ENABLE_LIVE_BILLING', originalLiveBilling)
})

describe('Stripe billing server adapter', () => {
  it('fails closed when STRIPE_SECRET_KEY is missing', () => {
    delete process.env.STRIPE_SECRET_KEY

    expect(() => createStripeClient()).toThrow(
      'STRIPE_SECRET_KEY is required for this server operation.'
    )
  })

  it('creates the official Stripe client when a server key is configured', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mr5c_fixture'

    expect(createStripeClient()).toBeInstanceOf(Stripe)
  })

  it('fails closed when STRIPE_WEBHOOK_SECRET is missing or blank', () => {
    process.env.STRIPE_WEBHOOK_SECRET = '   '

    expect(() => getStripeWebhookSecret()).toThrow(
      'STRIPE_WEBHOOK_SECRET is required for this server operation.'
    )
  })

  it('returns the trimmed Stripe webhook secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = '  whsec_mr5c_fixture  '

    expect(getStripeWebhookSecret()).toBe('whsec_mr5c_fixture')
  })

  it('maps verified Stripe test-mode events to TEST', () => {
    expect(
      billingEnvironmentFromVerifiedStripeEvent({ livemode: false })
    ).toBe('TEST')
  })

  it('maps verified Stripe live-mode events to LIVE', () => {
    expect(
      billingEnvironmentFromVerifiedStripeEvent({ livemode: true })
    ).toBe('LIVE')
  })

  it('allows TEST events while live billing remains disabled', () => {
    process.env.ENABLE_LIVE_BILLING = 'false'

    expect(
      assertStripeEventEnvironmentAllowed({ livemode: false })
    ).toBe('TEST')
  })

  it('rejects LIVE events unless live billing is explicitly enabled', () => {
    process.env.ENABLE_LIVE_BILLING = 'false'

    expect(() =>
      assertStripeEventEnvironmentAllowed({ livemode: true })
    ).toThrow('Live Stripe billing is disabled.')

    process.env.ENABLE_LIVE_BILLING = 'true'

    expect(
      assertStripeEventEnvironmentAllowed({ livemode: true })
    ).toBe('LIVE')
  })

  it('does not treat non-exact truthy values as live-billing authorization', () => {
    process.env.ENABLE_LIVE_BILLING = 'TRUE'

    expect(() =>
      assertStripeEventEnvironmentAllowed({ livemode: true })
    ).toThrow('Live Stripe billing is disabled.')
  })

  it('verifies an authentic Stripe webhook signature using the raw body', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mr5c_fixture'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mr5c_fixture'

    const rawBody = JSON.stringify({
      id: 'evt_mr5c_verified',
      object: 'event',
      api_version: null,
      created: 1_700_000_000,
      data: {
        object: {
          id: 'sub_mr5c_fixture',
          object: 'subscription',
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: null,
        idempotency_key: null,
      },
      type: 'customer.subscription.updated',
    })

    const stripe = createStripeClient()
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: 'whsec_mr5c_fixture',
    })

    const event = verifyStripeWebhookEvent(rawBody, signature)

    expect(event.id).toBe('evt_mr5c_verified')
    expect(event.type).toBe('customer.subscription.updated')
    expect(event.livemode).toBe(false)
  })

  it('rejects a tampered webhook body after the signature was generated', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mr5c_fixture'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mr5c_fixture'

    const rawBody = JSON.stringify({
      id: 'evt_mr5c_tamper',
      object: 'event',
      created: 1_700_000_000,
      data: { object: {} },
      livemode: false,
      type: 'customer.subscription.updated',
    })

    const stripe = createStripeClient()
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: 'whsec_mr5c_fixture',
    })

    const tamperedBody = rawBody.replace(
      'customer.subscription.updated',
      'customer.subscription.deleted'
    )

    expect(() =>
      verifyStripeWebhookEvent(tamperedBody, signature)
    ).toThrow()
  })

  it('fails closed when the Stripe-Signature header is missing or blank', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mr5c_fixture'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mr5c_fixture'

    expect(() =>
      verifyStripeWebhookEvent('{}', '   ')
    ).toThrow('Stripe-Signature header is required.')
  })})