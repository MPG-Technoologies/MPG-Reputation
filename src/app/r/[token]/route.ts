import { NextRequest, NextResponse } from 'next/server'
import { isValidTokenFormat, hashTrackingToken } from '@/domain/tracking'
import { validateGoogleReviewUrl } from '@/domain/destination'
import { isReviewRequestLinkExpired } from '@/domain/privacy/retention-controls'
import { createAdminClient } from '@/lib/supabase/admin'

function renderExpiredLinkHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Link Expired</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .card {
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
      max-width: 480px;
      width: 100%;
      margin: 16px;
      padding: 32px;
      box-sizing: border-box;
      text-align: center;
    }
    h1 {
      margin: 0 0 12px 0;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.3;
      color: #0f172a;
    }
    p {
      margin: 0 0 16px 0;
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
    }
    .footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Review Link Expired</h1>
    <p>This review request link is no longer active. Review request links expire after 90 days.</p>
    <p>Thank you for your feedback.</p>
    <div class="footer">
      MPG Reputation
    </div>
  </main>
</body>
</html>`.trim()
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params

  if (!isValidTokenFormat(token)) {
    return new NextResponse('Invalid or expired review link.', { status: 404 })
  }

  const tokenHash = hashTrackingToken(token)
  const supabase = createAdminClient()

  // 1. Resolve review request by token_hash
  const { data: reviewRequest, error: reqError } = await supabase
    .from('review_requests')
    .select('id, organization_id, location_id, destination_id, status, sent_at, created_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (reqError || !reviewRequest) {
    return new NextResponse('Review request not found or expired.', { status: 404 })
  }

  // MR-7C.4 Decision 4: 90-day review request routing link expiration.
  // After 90 days from authoritative request timestamp (sent_at ?? created_at),
  // routing fails closed, rendering a safe expired state with zero internal IDs.
  if (
    isReviewRequestLinkExpired({
      sent_at: reviewRequest.sent_at,
      created_at: reviewRequest.created_at,
    })
  ) {
    return new NextResponse(renderExpiredLinkHtml(), {
      status: 410,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
      },
    })
  }

  // Prompt Correction 7: Guard tracking click state
  // FAILED, CANCELLED, SUPPRESSED, or SCHEDULED requests must not become CLICKED
  // and must not increment click conversion metrics
  const invalidStates = ['FAILED', 'CANCELLED', 'SUPPRESSED', 'SCHEDULED']
  if (invalidStates.includes(reviewRequest.status)) {
    return new NextResponse('This review request is no longer available or was cancelled.', { status: 410 })
  }

  // 2. Verify active organization
  const { data: org } = await supabase
    .from('organizations')
    .select('id, status')
    .eq('id', reviewRequest.organization_id)
    .single()

  if (!org || org.status !== 'ACTIVE') {
    return new NextResponse('This location is currently inactive.', { status: 404 })
  }

  // 3. Verify active location
  const { data: loc } = await supabase
    .from('locations')
    .select('id, status')
    .eq('id', reviewRequest.location_id)
    .single()

  if (!loc || loc.status !== 'ACTIVE') {
    return new NextResponse('This location is currently inactive.', { status: 404 })
  }

  // 4. Resolve confirmed review destination
  let destinationUrl: string | null = null

  if (reviewRequest.destination_id) {
    const { data: dest } = await supabase
      .from('review_destinations')
      .select('canonical_url, status')
      .eq('id', reviewRequest.destination_id)
      .maybeSingle()

    if (dest && dest.status === 'CONFIRMED') {
      destinationUrl = dest.canonical_url
    }
  }

  // Fallback: check active confirmed Google destination for location
  if (!destinationUrl) {
    const { data: fallbackDest } = await supabase
      .from('review_destinations')
      .select('canonical_url, status')
      .eq('location_id', reviewRequest.location_id)
      .eq('provider', 'google')
      .eq('status', 'CONFIRMED')
      .maybeSingle()

    if (fallbackDest) {
      destinationUrl = fallbackDest.canonical_url
    }
  }

  if (!destinationUrl) {
    return new NextResponse('No review destination is configured for this location.', { status: 404 })
  }

  // Double-check destination URL against open-redirect protection
  const validated = validateGoogleReviewUrl(destinationUrl)
  if (!validated.valid || !validated.canonicalUrl) {
    return new NextResponse('Review destination URL is invalid.', { status: 500 })
  }

  // 5. Asynchronously record first click if in a deliverable sent state (SENT or DELIVERED)
  // Data Minimization (Prompt Correction 17): Do not store raw IP or unnecessary client headers.
  // Click Idempotency (Prompt Correction 18 & 7): Only SENT/DELIVERED requests transition to CLICKED.
  // Repeated valid clicks (already CLICKED) redirect safely without duplicating metrics.
  if (reviewRequest.status === 'SENT' || reviewRequest.status === 'DELIVERED') {
    try {
      const { data: updatedRequest } = await supabase
        .from('review_requests')
        .update({
          status: 'CLICKED',
          clicked_at: new Date().toISOString(),
        })
        .eq('id', reviewRequest.id)
        .in('status', ['SENT', 'DELIVERED'])
        .select('id')
        .maybeSingle()

      if (updatedRequest) {
        // Record first-click event without raw IP (privacy-first data minimization)
        await supabase.from('review_request_events').insert({
          organization_id: reviewRequest.organization_id,
          review_request_id: reviewRequest.id,
          event_type: 'first_click',
          metadata: {
            timestamp: new Date().toISOString(),
          },
        })

        // Atomic usage increment via service_role admin client
        const period = new Date().toISOString().slice(0, 7)
        await supabase.rpc('increment_organization_usage', {
          p_org_id: reviewRequest.organization_id,
          p_period: period,
          p_metric: 'link_clicks',
          p_amount: 1,
        })

        // MR-4: Record tracked_click in usage_ledger
        await supabase.rpc('record_usage_event', {
          p_org_id: reviewRequest.organization_id,
          p_event_type: 'tracked_click',
          p_channel: 'email',
          p_units: 1,
          p_entity_type: 'tracked_link',
          p_entity_id: reviewRequest.id,
          p_idempotency_key: `tracked-click:${reviewRequest.id}`,
        })
      }
    } catch (err) {
      console.error('Failed to record review request click analytics:', err)
    }
  }

  // 6. Safe HTTP 302 redirect directly to confirmed Google review URL
  return NextResponse.redirect(validated.canonicalUrl, { status: 302 })
}
