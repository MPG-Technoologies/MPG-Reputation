import { verifyStripeWebhookEvent } from '@/lib/billing/stripe'
import { claimVerifiedStripeWebhookEvent } from '@/lib/billing/stripe-webhook-store'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

function hasStripeWebhookServerConfiguration(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      process.env.STRIPE_WEBHOOK_SECRET?.trim()
  )
}

/**
 * Stripe webhook intake boundary.
 *
 * Responsibilities are intentionally narrow:
 * 1. Require Stripe-Signature.
 * 2. Preserve the exact raw request body.
 * 3. Cryptographically verify the event.
 * 4. Atomically persist the provider Event ID.
 * 5. Return quickly after durable intake.
 *
 * Subscription projection, provider-truth retrieval, entitlement changes,
 * checkout, portal, and other billing effects belong to later MR-5 slices.
 */
export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature')?.trim()

  if (!signature) {
    return new Response('Missing Stripe-Signature header', {
      status: 400,
    })
  }

  if (!hasStripeWebhookServerConfiguration()) {
    console.error(
      '[StripeWebhook] Stripe webhook server configuration is incomplete.'
    )

    return new Response('Server configuration error', {
      status: 500,
    })
  }

  // Stripe signature verification requires the exact unmodified body.
  const rawBody = await req.text()

  let event

  try {
    event = verifyStripeWebhookEvent(rawBody, signature)
  } catch {
    console.warn(
      '[StripeWebhook] Cryptographic signature verification failed.'
    )

    return new Response('Invalid webhook signature', {
      status: 400,
    })
  }

  let claim

  try {
    claim = await claimVerifiedStripeWebhookEvent({
      supabase: createAdminClient(),
      event,
      rawBody,
    })
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'Live Stripe billing is disabled.'
    ) {
      console.warn(
        '[StripeWebhook] Verified LIVE event rejected because live billing is disabled.'
      )

      return new Response('Live billing is disabled', {
        status: 503,
      })
    }

    console.error(
      '[StripeWebhook] Durable billing webhook event claim failed.'
    )

    return new Response('Webhook persistence error', {
      status: 500,
    })
  }

  switch (claim.outcome) {
    case 'CLAIMED':
      return Response.json(
        {
          received: true,
          claimed: true,
        },
        { status: 200 }
      )

    case 'EXISTING_FINAL':
      return Response.json(
        {
          received: true,
          duplicate: true,
          final: true,
        },
        { status: 200 }
      )

    case 'EXISTING_INCOMPLETE':
      // The Event ID is already durably recorded. Downstream processing and
      // recovery operate from the persisted claim instead of relying on
      // another Stripe delivery.
      return Response.json(
        {
          received: true,
          duplicate: true,
          final: false,
        },
        { status: 200 }
      )

    case 'PAYLOAD_CONFLICT':
      // A verified Event ID should be immutable. Do not overwrite the
      // previously claimed representation if the authenticated wire payload
      // unexpectedly differs.
      console.warn(
        '[StripeWebhook] Verified duplicate Event ID produced a payload hash conflict:',
        event.id
      )

      return Response.json(
        {
          received: false,
          conflict: true,
        },
        { status: 409 }
      )
  }

  return new Response('Unhandled webhook claim state', {
    status: 500,
  })
}