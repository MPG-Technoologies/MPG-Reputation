import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const isDbAvailable = !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'dummy_service_role_key'

// Mock createClient from '@/lib/supabase/server' so actions use our selected test client
let activeClient: ReturnType<typeof createSupabaseClient<Database>> | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { updateLocationSettings } from '../../src/actions/locations'

describe.skipIf(!isDbAvailable)('Location Reply-To Authorization & Tenant Isolation (MR-1B.1 Section 5)', () => {
  let adminClient: ReturnType<typeof createSupabaseClient<Database>>
  let ownerClient: ReturnType<typeof createSupabaseClient<Database>>
  let adminUserClient: ReturnType<typeof createSupabaseClient<Database>>
  let operatorClient: ReturnType<typeof createSupabaseClient<Database>>
  let viewerClient: ReturnType<typeof createSupabaseClient<Database>>
  let orgBClient: ReturnType<typeof createSupabaseClient<Database>>

  let ownerUserId: string
  let adminUserId: string
  let operatorUserId: string
  let viewerUserId: string
  let orgBUserId: string

  let orgAId: string
  let orgBId: string
  let locAId: string
  let locBId: string

  const timestamp = Date.now()

  beforeAll(async () => {
    adminClient = createSupabaseClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1. Create test users in Auth
    const createTestUser = async (email: string) => {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: 'Password123!',
        email_confirm: true,
      })
      if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
      const client = createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      await client.auth.signInWithPassword({ email, password: 'Password123!' })
      return { id: data.user.id, client }
    }

    const uOwner = await createTestUser(`replyto_owner_${timestamp}@test.local`)
    const uAdmin = await createTestUser(`replyto_admin_${timestamp}@test.local`)
    const uOperator = await createTestUser(`replyto_operator_${timestamp}@test.local`)
    const uViewer = await createTestUser(`replyto_viewer_${timestamp}@test.local`)
    const uOrgB = await createTestUser(`replyto_orgb_${timestamp}@test.local`)

    ownerUserId = uOwner.id
    ownerClient = uOwner.client
    adminUserId = uAdmin.id
    adminUserClient = uAdmin.client
    operatorUserId = uOperator.id
    operatorClient = uOperator.client
    viewerUserId = uViewer.id
    viewerClient = uViewer.client
    orgBUserId = uOrgB.id
    orgBClient = uOrgB.client

    // 2. Create Organization A and Location A
    const { data: orgA } = await adminClient
      .from('organizations')
      .insert({
        name: `Reply-To Org A ${timestamp}`,
        slug: `replyto-org-a-${timestamp}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    orgAId = orgA!.id

    const { data: locA } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgAId,
        name: 'Location A Main',
        status: 'ACTIVE',
        review_reply_to_email: null,
      })
      .select('id')
      .single()
    locAId = locA!.id

    // 3. Create Organization B and Location B
    const { data: orgB } = await adminClient
      .from('organizations')
      .insert({
        name: `Reply-To Org B ${timestamp}`,
        slug: `replyto-org-b-${timestamp}`,
        status: 'ACTIVE',
      })
      .select('id')
      .single()
    orgBId = orgB!.id

    const { data: locB } = await adminClient
      .from('locations')
      .insert({
        organization_id: orgBId,
        name: 'Location B Main',
        status: 'ACTIVE',
        review_reply_to_email: null,
      })
      .select('id')
      .single()
    locBId = locB!.id

    // 4. Assign Roles in Org A
    await adminClient.from('organization_users').insert([
      { organization_id: orgAId, user_id: ownerUserId, role: 'OWNER' },
      { organization_id: orgAId, user_id: adminUserId, role: 'ADMIN' },
      { organization_id: orgAId, user_id: operatorUserId, role: 'OPERATOR' },
      { organization_id: orgAId, user_id: viewerUserId, role: 'VIEWER' },
    ])

    // 5. Assign Role in Org B
    await adminClient.from('organization_users').insert([
      { organization_id: orgBId, user_id: orgBUserId, role: 'OWNER' },
    ])
  })

  afterAll(async () => {
    // Cleanup created test records
    await adminClient.from('locations').delete().in('id', [locAId, locBId])
    await adminClient.from('organization_users').delete().in('organization_id', [orgAId, orgBId])
    await adminClient.from('organizations').delete().in('id', [orgAId, orgBId])
    await adminClient.auth.admin.deleteUser(ownerUserId)
    await adminClient.auth.admin.deleteUser(adminUserId)
    await adminClient.auth.admin.deleteUser(operatorUserId)
    await adminClient.auth.admin.deleteUser(viewerUserId)
    await adminClient.auth.admin.deleteUser(orgBUserId)
  })

  beforeEach(() => {
    activeClient = null
  })

  it('1. authorized same-organization OWNER configuration succeeds', async () => {
    activeClient = ownerClient

    const formData = new FormData()
    formData.append('organizationId', orgAId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'feedback@northstar-a.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(true)

    // Verify DB update
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).toBe('feedback@northstar-a.test')

    // Verify audit event
    const { data: audits } = await adminClient
      .from('audit_events')
      .select('*')
      .eq('organization_id', orgAId)
      .eq('event_type', 'location.updated')
      .eq('entity_id', locAId)

    expect(audits?.length).toBeGreaterThan(0)
    expect(audits?.[0].actor_id).toBe(ownerUserId)
  })

  it('1b. authorized same-organization ADMIN configuration succeeds', async () => {
    activeClient = adminUserClient

    const formData = new FormData()
    formData.append('organizationId', orgAId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'admin-reply@northstar-a.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(true)

    // Verify DB update
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).toBe('admin-reply@northstar-a.test')
  })

  it('2. unauthenticated update fails', async () => {
    // Client with no authenticated session
    activeClient = createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const formData = new FormData()
    formData.append('organizationId', orgAId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'unauth@attacker.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Authentication required/)

    // Verify DB was NOT updated
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).not.toBe('unauth@attacker.test')
  })

  it('3a. cross-organization update fails when user belongs to Org B but tries to update Org A', async () => {
    // User from Org B targeting Org A
    activeClient = orgBClient

    const formData = new FormData()
    formData.append('organizationId', orgAId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'cross-org@attacker.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Access denied: You are not a member of this organization/)

    // Verify DB was NOT updated
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).not.toBe('cross-org@attacker.test')
  })

  it('3b. cross-organization update fails when passing Org B ID but Location A ID', async () => {
    // User from Org B claiming locA belongs to Org B
    activeClient = orgBClient

    const formData = new FormData()
    formData.append('organizationId', orgBId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'spoof@attacker.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Location does not belong to this organization/)
  })

  it('4a. unauthorized VIEWER role cannot change Reply-To', async () => {
    activeClient = viewerClient

    const formData = new FormData()
    formData.append('organizationId', orgAId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'viewer-hack@northstar-a.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Access denied: Only owners and administrators/)

    // Verify DB was NOT updated
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).not.toBe('viewer-hack@northstar-a.test')
  })

  it('4b. unauthorized OPERATOR role cannot change Reply-To (Governance Rule)', async () => {
    activeClient = operatorClient

    const formData = new FormData()
    formData.append('organizationId', orgAId)
    formData.append('locationId', locAId)
    formData.append('reviewReplyToEmail', 'operator-hack@northstar-a.test')

    const result = await updateLocationSettings(formData)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Access denied: Only owners and administrators/)

    // Verify DB was NOT updated
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).not.toBe('operator-hack@northstar-a.test')
  })

  it('5. CR/LF and header injection attempts remain rejected', async () => {
    activeClient = ownerClient

    const injectionPayloads = [
      'attacker@evil.test\r\nBcc: victim@target.test',
      'attacker@evil.test\nSubject: Injected',
      'attacker@evil.test\r',
      '<injected@evil.test>',
      'attacker@evil.test\0evil',
      'not-an-email',
      '@missing-user.com',
      'missing-domain@',
    ]

    for (const payload of injectionPayloads) {
      const formData = new FormData()
      formData.append('organizationId', orgAId)
      formData.append('locationId', locAId)
      formData.append('reviewReplyToEmail', payload)

      const result = await updateLocationSettings(formData)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid Reply-To email address')
    }

    // Verify DB was NOT corrupted with any injection payload
    const { data: loc } = await adminClient
      .from('locations')
      .select('review_reply_to_email')
      .eq('id', locAId)
      .single()

    expect(loc?.review_reply_to_email).toBe('admin-reply@northstar-a.test')
  })
})
