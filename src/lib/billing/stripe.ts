import Stripe from 'stripe'
import type { BillingEnvironment } from '@/domain/billing'

export function createStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required for this server operation.')
  }

  return new Stripe(secretKey)
}

export function getStripeWebhookSecret() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for this server operation.')
  }

  return webhookSecret
}

export function verifyStripeWebhookEvent(
  rawBody: string | Buffer,
  signature: string
): Stripe.Event {
  const normalizedSignature = signature.trim()

  if (!normalizedSignature) {
    throw new Error('Stripe-Signature header is required.')
  }

  const stripe = createStripeClient()
  const webhookSecret = getStripeWebhookSecret()

  return stripe.webhooks.constructEvent(
    rawBody,
    normalizedSignature,
    webhookSecret
  )
}
/**
 * Call this only after Stripe cryptographic signature verification succeeds.
 * Stripe Event.livemode is the trusted provider signal for TEST/LIVE isolation.
 */
export function billingEnvironmentFromVerifiedStripeEvent(
  event: Pick<Stripe.Event, 'livemode'>
): BillingEnvironment {
  return event.livemode ? 'LIVE' : 'TEST'
}

/**
 * LIVE persistence is structurally supported but remains owner-gated.
 * Only an exact "true" enables LIVE billing behavior.
 */
export function assertStripeEventEnvironmentAllowed(
  event: Pick<Stripe.Event, 'livemode'>
): BillingEnvironment {
  const environment = billingEnvironmentFromVerifiedStripeEvent(event)

  if (environment === 'LIVE' && process.env.ENABLE_LIVE_BILLING !== 'true') {
    throw new Error('Live Stripe billing is disabled.')
  }

  return environment
}