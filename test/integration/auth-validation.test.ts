import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54331'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const APP_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000'

describe('Local Authentication Lifecycle Validation (Section 13)', () => {
  let adminClient: SupabaseClient<Database>
  let userClient: SupabaseClient<Database>
  let userId: string
  const timestamp = Date.now()
  const userEmail = `auth_test_${timestamp}@example.test`
  const password = 'StrongAuthPassword123!'

  beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    userClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  })

  afterAll(async () => {
    if (adminClient && userId) {
      await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('1. Protected route behavior: unauthenticated request to /app/dashboard redirects to /login', async () => {
    const res = await fetch(`${APP_URL}/app/dashboard`, { redirect: 'manual' })
    expect([307, 308, 302, 303]).toContain(res.status)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
  })

  it('2. Protected route behavior: unauthenticated request to /onboarding redirects to /login', async () => {
    const res = await fetch(`${APP_URL}/onboarding`, { redirect: 'manual' })
    expect([307, 308, 302, 303]).toContain(res.status)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
  })

  it('3. Signup: creates synthetic user successfully with local GoTrue auth', async () => {
    const { data: signUpData, error: signUpErr } = await userClient.auth.signUp({
      email: userEmail,
      password: password,
    })
    expect(signUpErr).toBeNull()
    expect(signUpData.user).toBeDefined()
    userId = signUpData.user!.id
  })

  it('4. Login with invalid password fails with descriptive error', async () => {
    const { data, error } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: 'WrongPassword!',
    })
    expect(error).toBeDefined()
    expect(data.session).toBeNull()
  })

  it('5. Login with valid credentials succeeds and issues active session', async () => {
    const { data, error } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: password,
    })
    expect(error).toBeNull()
    expect(data.session).toBeDefined()
    expect(data.session?.access_token).toBeDefined()
    expect(data.user?.id).toBe(userId)
  })

  it('6. Logout terminates session', async () => {
    const { error: signOutErr } = await userClient.auth.signOut()
    expect(signOutErr).toBeNull()

    const { data: userData } = await userClient.auth.getUser()
    expect(userData.user).toBeNull()
  })

  it('7. Login again restores authenticated session', async () => {
    const { data, error } = await userClient.auth.signInWithPassword({
      email: userEmail,
      password: password,
    })
    expect(error).toBeNull()
    expect(data.session).toBeDefined()
    expect(data.user?.id).toBe(userId)
  })
})
