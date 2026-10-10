#!/usr/bin/env node

/**
 * ==============================================================================
 * MPG REPUTATION — DETERMINISTIC LOCAL DEV AUTH & TENANT BOOTSTRAP SCRIPT
 * ==============================================================================
 * Purpose: Creates a deterministic synthetic development user, organization,
 *          location, and confirmed review destination using the official
 *          Supabase Auth Admin API and service-role database client.
 *
 * Safety Invariants:
 *   - Strictly guarded: refuses to execute against any non-local Supabase URL.
 *   - Uses official GoTrue Auth Admin API (createUser/updateUserById).
 *   - Zero production credentials or live customer data.
 *   - Fully idempotent: safe to execute repeatedly.
 * ==============================================================================
 */

import { fileURLToPath } from 'url'
import path from 'path'
import process from 'process'
import { createClient } from '@supabase/supabase-js'

export const ALLOWED_LOCAL_SUPABASE_ORIGINS = new Set([
  'http://127.0.0.1:54331',
  'http://localhost:54331',
])

export function assertAllowedLocalSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error(`[BOOTSTRAP FATAL] Invalid Supabase URL: expected non-empty string, got ${rawUrl}`)
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`[BOOTSTRAP FATAL] Refusing to run dev bootstrap against malformed Supabase URL: ${rawUrl}`)
  }

  if (!ALLOWED_LOCAL_SUPABASE_ORIGINS.has(parsed.origin)) {
    throw new Error(
      `[BOOTSTRAP FATAL] Refusing to run dev bootstrap against non-local Supabase URL: ${rawUrl}. Allowed origins: ${Array.from(ALLOWED_LOCAL_SUPABASE_ORIGINS).join(', ')}`
    )
  }

  return parsed.origin
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const DEV_USER_EMAIL = 'developer@local.test'
const DEV_USER_PASSWORD = 'SafePassword123!'
const SYNTHETIC_ORG_ID = 'b0000000-0000-0000-0000-000000000001'
const SYNTHETIC_LOC_ID = 'c0000000-0000-0000-0000-000000000001'
const SYNTHETIC_DEST_ID = 'd0000000-0000-0000-0000-000000000001'

export async function bootstrap(supabaseClient) {
  let supabase = supabaseClient
  if (!supabase) {
    assertAllowedLocalSupabaseUrl(SUPABASE_URL)
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }

  console.log(`[BOOTSTRAP] Connecting to local Supabase at ${SUPABASE_URL}...`)

  // 2. Deterministic Auth User via GoTrue Admin API
  let userId
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 })
  if (listError) {
    throw new Error(`Failed to list local auth users: ${listError.message}`)
  }

  const existing = listData?.users?.find((u) => u.email === DEV_USER_EMAIL)
  if (existing) {
    console.log(`[BOOTSTRAP] Existing user found: ${existing.id} (${DEV_USER_EMAIL})`)
    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password: DEV_USER_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Local Developer' },
    })
    if (updateError) {
      throw new Error(`Failed to update existing dev user: ${updateError.message}`)
    }
    userId = updated.user.id
  } else {
    console.log(`[BOOTSTRAP] Creating new synthetic auth user via Admin API...`)
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: DEV_USER_EMAIL,
      password: DEV_USER_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Local Developer' },
    })
    if (createError) {
      throw new Error(`Failed to create synthetic dev user: ${createError.message}`)
    }
    userId = created.user.id
    console.log(`[BOOTSTRAP] Created synthetic user: ${userId} (${DEV_USER_EMAIL})`)
  }

  // 3. Deterministic Synthetic Organization
  const { data: orgData, error: orgError } = await supabase
    .from('organizations')
    .upsert({
      id: SYNTHETIC_ORG_ID,
      name: 'Northstar Dental (Local Dev)',
      slug: 'northstar-dental-local-dev',
      country: 'CA',
      timezone: 'America/Toronto',
      status: 'ACTIVE',
    }, { onConflict: 'id' })
    .select('id, name')
    .single()

  if (orgError) {
    throw new Error(`Failed to upsert synthetic organization: ${orgError.message}`)
  }
  console.log(`[BOOTSTRAP] Organization confirmed: ${orgData.name} (${orgData.id})`)

  // 4. OWNER Membership
  const { error: memberError } = await supabase
    .from('organization_users')
    .upsert({
      organization_id: SYNTHETIC_ORG_ID,
      user_id: userId,
      role: 'OWNER',
    }, { onConflict: 'organization_id,user_id' })

  if (memberError) {
    throw new Error(`Failed to upsert OWNER membership: ${memberError.message}`)
  }
  console.log(`[BOOTSTRAP] OWNER membership established for user ${userId} in org ${SYNTHETIC_ORG_ID}`)

  // 5. Active Primary Location
  const { data: locData, error: locError } = await supabase
    .from('locations')
    .upsert({
      id: SYNTHETIC_LOC_ID,
      organization_id: SYNTHETIC_ORG_ID,
      name: 'Main Clinic',
      address: '100 Market Street, Suite 400',
      country: 'CA',
      timezone: 'America/Toronto',
      status: 'ACTIVE',
    }, { onConflict: 'id' })
    .select('id, name')
    .single()

  if (locError) {
    throw new Error(`Failed to upsert primary location: ${locError.message}`)
  }
  console.log(`[BOOTSTRAP] Location confirmed: ${locData.name} (${locData.id})`)

  // 6. Confirmed Synthetic Review Destination
  const { error: destError } = await supabase
    .from('review_destinations')
    .upsert({
      id: SYNTHETIC_DEST_ID,
      organization_id: SYNTHETIC_ORG_ID,
      location_id: SYNTHETIC_LOC_ID,
      provider: 'google',
      url: 'https://g.page/r/synthetic-northstar-dev/review',
      canonical_url: 'https://g.page/r/synthetic-northstar-dev/review',
      status: 'CONFIRMED',
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (destError) {
    throw new Error(`Failed to upsert review destination: ${destError.message}`)
  }
  console.log(`[BOOTSTRAP] Confirmed Google review destination established (${SYNTHETIC_DEST_ID})`)

  // 7. Trial Entitlement Provisioning
  const { error: trialError } = await supabase.rpc('provision_organization_trial', {
    p_org_id: SYNTHETIC_ORG_ID,
    p_allocated_requests: 30,
    p_duration_days: 30,
  })

  if (trialError) {
    throw new Error(`Failed to provision trial entitlement: ${trialError.message}`)
  }
  console.log(`[BOOTSTRAP] Trial entitlement provisioned: 30 requests / 30 days`)

  console.log(`[BOOTSTRAP SUCCESS] Deterministic local development environment ready!`)
  console.log(`                    Email:    ${DEV_USER_EMAIL}`)
  console.log(`                    Password: ${DEV_USER_PASSWORD}`)
  console.log(`                    Target:   ${SUPABASE_URL}`)
}

const isDirectExecution = Boolean(
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)

if (isDirectExecution) {
  try {
    assertAllowedLocalSupabaseUrl(SUPABASE_URL)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  bootstrap(supabase).catch((err) => {
    console.error(`[BOOTSTRAP ERROR]`, err)
    process.exit(1)
  })
}
