import { NextRequest, NextResponse } from 'next/server'
import { isValidTokenFormat, hashTrackingToken } from '@/domain/tracking'
import { validateGoogleReviewUrl } from '@/domain/destination'
import { createAdminClient } from '@/lib/supabase/admin'

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
    .select('id, organization_id, location_id, destination_id, status')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (reqError || !reviewRequest) {
    return new NextResponse('Review request not found or expired.', { status: 404 })
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

  // 5. Asynchronously record click (must not block customer redirect)
  // Data Minimization (Prompt Correction 17): Do not store raw IP or unnecessary client headers.
  // Click Idempotency (Prompt Correction 18): Atomic state transition guards first click from duplicate increments.
  try {
    const { data: updatedRequest } = await supabase
      .from('review_requests')
      .update({
        status: 'CLICKED',
        clicked_at: new Date().toISOString(),
      })
      .eq('id', reviewRequest.id)
      .neq('status', 'CLICKED')
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

      // Atomic usage increment
      const period = new Date().toISOString().slice(0, 7)
      await supabase.rpc('increment_organization_usage', {
        p_org_id: reviewRequest.organization_id,
        p_period: period,
        p_metric: 'link_clicks',
        p_amount: 1,
      })
    }
  } catch (err) {
    console.error('Failed to record review request click analytics:', err)
  }

  // 6. Safe HTTP 302 redirect directly to confirmed Google review URL
  return NextResponse.redirect(validated.canonicalUrl, { status: 302 })
}
