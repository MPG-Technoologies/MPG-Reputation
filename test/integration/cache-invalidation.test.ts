import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidatePathMock = vi.fn()
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

vi.mock('@/inngest/client', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: ['mock-outbox-id'] }),
  },
}))

let mockUser: { id: string; email: string } | null = {
  id: 'user_123',
  email: 'test@example.test',
}

let mockMembership: { role: string } | null = { role: 'OWNER' }
let mockLocation: { id: string; status: string } | null = {
  id: 'loc_123',
  status: 'ACTIVE',
}
let mockExistingDestination: {
  id: string
  location_id?: string
  status?: string
  canonical_url?: string | null
} | null = null

const mockSupabase = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: mockUser },
      error: mockUser ? null : { message: 'Not authenticated' },
    })),
    signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
      if (password === 'wrong') return { data: { session: null }, error: { message: 'Invalid credentials' } }
      return { data: { session: { access_token: 'token_123' }, user: { id: 'user_123', email } }, error: null }
    }),
    signUp: vi.fn(async ({ email, password }: { email: string; password: string }) => {
      if (password === 'short') return { data: { session: null, user: null }, error: { message: 'Password too short' } }
      return { data: { session: { access_token: 'token_123' }, user: { id: 'user_123', email } }, error: null }
    }),
    signOut: vi.fn(async () => ({ error: null })),
  },
  rpc: vi.fn(async (fnName: string) => {
    if (fnName === 'create_org_with_owner_and_location') {
      return { data: { organization_id: 'org_123', location_id: 'loc_123' }, error: null }
    }
    if (fnName === 'submit_quick_complete_atomic') {
      return {
        data: {
          customer_id: 'cust_123',
          completion_event_id: 'comp_123',
          outbox_id: 'outbox_123',
          source_event_id: 'src_123',
        },
        error: null,
      }
    }
    return { data: null, error: null }
  }),
  from: vi.fn((table: string) => {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                if (table === 'customer_completion_events') {
                  return { data: null }
                }
                if (table === 'review_destinations') {
                  return {
                    data: mockExistingDestination,
                    error: null,
                  }
                }
                return { data: null }
              }),
            })),
            maybeSingle: vi.fn(async () => {
              if (table === 'organization_users') return { data: mockMembership, error: null }
              if (table === 'locations') return { data: mockLocation, error: null }
              if (table === 'review_destinations') return { data: mockExistingDestination, error: null }
              return { data: null, error: null }
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: 'dest_123' },
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => {
        const terminal = {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: 'dest_123' },
              error: null,
            })),
          })),
        }

        return {
          eq: vi.fn(() => ({
            ...terminal,
            eq: vi.fn(() => terminal),
          })),
        }
      }),
    }
  }),
}

const mockAdminClient = {
  from: vi.fn(() => ({
    insert: vi.fn(async () => ({ error: null })),
  })),
  rpc: vi.fn(async () => ({ error: null })),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

import { createOrganizationAndLocation } from '@/actions/onboarding'
import { deactivateDestination, saveDestination } from '@/actions/destinations'
import { submitQuickComplete } from '@/actions/quick-complete'
import { createLocation } from '@/actions/locations'
import { signIn, signUp, signOut } from '@/actions/auth'

describe('Cache Invalidation & Router State Transitions (Regression Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = { id: 'user_123', email: 'test@example.test' }
    mockMembership = { role: 'OWNER' }
    mockLocation = {
      id: 'loc_123',
      status: 'ACTIVE',
    }
    mockExistingDestination = null
  })

  describe('1. Onboarding Mutation', () => {
    it('invalidates /app layout, review-destination, and onboarding routes before redirecting', async () => {
      const formData = new FormData()
      formData.append('orgName', 'Northstar Dental')
      formData.append('locName', 'Main Clinic')

      await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
        'NEXT_REDIRECT:/app/settings/review-destination'
      )

      expect(revalidatePathMock).toHaveBeenCalledWith('/app', 'layout')
      expect(revalidatePathMock).toHaveBeenCalledWith('/app/settings/review-destination')
      expect(revalidatePathMock).toHaveBeenCalledWith('/onboarding')
      expect(redirectMock).toHaveBeenCalledWith('/app/settings/review-destination')
    })

    it('does not invalidate cache on validation failure', async () => {
      const formData = new FormData()
      formData.append('orgName', '') // missing required

      await expect(createOrganizationAndLocation(formData)).rejects.toThrow(
        'NEXT_REDIRECT:/onboarding?error='
      )

      expect(revalidatePathMock).not.toHaveBeenCalled()
    })
  })

  describe('2. Review Destination Mutation', () => {
    it('invalidates review-destination and dashboard routes on successful destination save', async () => {
      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append('url', 'https://g.page/r/synthetic-test-place/review')

      const result = await saveDestination(formData)

      expect(result.success).toBe(true)
      expect(result.canonicalUrl).toBe('https://g.page/r/synthetic-test-place/review')
      expect(revalidatePathMock).toHaveBeenCalledWith('/app/settings/review-destination')
      expect(revalidatePathMock).toHaveBeenCalledWith('/app/dashboard')
    })

    it('changing a confirmed destination resets it to pending confirmation', async () => {
      mockExistingDestination = {
        id: 'dest_123',
        location_id: 'loc_123',
        status: 'CONFIRMED',
        canonical_url: 'https://g.page/r/old-place/review',
      }

      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append(
        'url',
        'https://g.page/r/replacement-place/review'
      )

      const result = await saveDestination(formData)

      expect(result.success).toBe(true)
      expect(result.status).toBe('PENDING_CONFIRMATION')
      expect(revalidatePathMock).toHaveBeenCalledWith(
        '/app/quick-complete'
      )
    })

    it('allows a confirmed destination to be paused immediately', async () => {
      mockExistingDestination = {
        id: 'dest_123',
        location_id: 'loc_123',
        status: 'CONFIRMED',
        canonical_url: 'https://g.page/r/synthetic-test-place/review',
      }

      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')

      const result = await deactivateDestination(formData)

      expect(result.success).toBe(true)
      expect(result.status).toBe('INACTIVE')
      expect(revalidatePathMock).toHaveBeenCalledWith(
        '/app/dashboard'
      )
      expect(revalidatePathMock).toHaveBeenCalledWith(
        '/app/quick-complete'
      )
    })

    it('does not invalidate cache when URL is invalid', async () => {
      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append('url', 'https://invalid-non-google-url.example.com')

      const result = await saveDestination(formData)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(revalidatePathMock).not.toHaveBeenCalled()
    })

    it('does not invalidate cache when user role is VIEWER', async () => {
      mockMembership = { role: 'VIEWER' }

      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append('url', 'https://g.page/r/synthetic-test-place/review')

      const result = await saveDestination(formData)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Only owners and administrators')
      expect(revalidatePathMock).not.toHaveBeenCalled()
    })
  })

  describe('3. Quick Complete Mutation', () => {
    it('invalidates /app/dashboard after recording a completion', async () => {
      mockExistingDestination = {
        id: 'dest_123',
        location_id: 'loc_123',
        status: 'CONFIRMED',
        canonical_url: 'https://g.page/r/synthetic-test-place/review',
      }

      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append('firstName', 'Jane')
      formData.append('email', 'jane@example.test')
      formData.append('permissionEmail', 'allowed')

      const result = await submitQuickComplete(formData)

      expect(result.success).toBe(true)
      expect(revalidatePathMock).toHaveBeenCalledWith('/app/dashboard')
    })

    it('blocks Quick Complete while destination confirmation is pending', async () => {
      mockExistingDestination = {
        id: 'dest_123',
        location_id: 'loc_123',
        status: 'PENDING_CONFIRMATION',
        canonical_url: 'https://g.page/r/synthetic-test-place/review',
      }

      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append('firstName', 'Jane')
      formData.append('email', 'jane@example.test')
      formData.append('permissionEmail', 'allowed')

      const result = await submitQuickComplete(formData)

      expect(result.success).toBe(false)
      expect(result.error).toContain(
        'not ready for automation'
      )
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
      expect(revalidatePathMock).not.toHaveBeenCalled()
    })

    it('does not invalidate cache on validation failure (missing email)', async () => {
      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('locationId', 'loc_123')
      formData.append('firstName', 'Jane')
      formData.append('email', '') // missing required email

      const result = await submitQuickComplete(formData)

      expect(result.success).toBe(false)
      expect(revalidatePathMock).not.toHaveBeenCalled()
    })
  })

  describe('4. Location Creation Mutation', () => {
    it('invalidates location settings, review-destination, quick-complete, and app layout before redirecting', async () => {
      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('name', 'East Branch')
      formData.append('address', '100 Main St')

      await expect(createLocation(formData)).rejects.toThrow(
        'NEXT_REDIRECT:/app/settings/location?success=Location%20created'
      )

      expect(revalidatePathMock).toHaveBeenCalledWith('/app/settings/location')
      expect(revalidatePathMock).toHaveBeenCalledWith('/app/settings/review-destination')
      expect(revalidatePathMock).toHaveBeenCalledWith('/app/quick-complete')
      expect(revalidatePathMock).toHaveBeenCalledWith('/app', 'layout')
      expect(redirectMock).toHaveBeenCalledWith('/app/settings/location?success=Location%20created')
    })

    it('does not invalidate cache on missing name', async () => {
      const formData = new FormData()
      formData.append('organizationId', 'org_123')
      formData.append('name', '') // missing name

      await expect(createLocation(formData)).rejects.toThrow(
        'NEXT_REDIRECT:/app/settings/location?error='
      )

      expect(revalidatePathMock).not.toHaveBeenCalled()
    })
  })

  describe('5. Auth State Mutations', () => {
    it('signIn invalidates root layout before redirecting to /app', async () => {
      const formData = new FormData()
      formData.append('email', 'user@example.test')
      formData.append('password', 'ValidPassword123!')

      await expect(signIn(formData)).rejects.toThrow('NEXT_REDIRECT:/app')

      expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
      expect(redirectMock).toHaveBeenCalledWith('/app')
    })

    it('signUp invalidates root layout before redirecting to /onboarding', async () => {
      const formData = new FormData()
      formData.append('email', 'newuser@example.test')
      formData.append('password', 'ValidPassword123!')

      await expect(signUp(formData)).rejects.toThrow('NEXT_REDIRECT:/onboarding')

      expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
      expect(redirectMock).toHaveBeenCalledWith('/onboarding')
    })

    it('signOut invalidates root layout before redirecting to /login', async () => {
      await expect(signOut()).rejects.toThrow('NEXT_REDIRECT:/login')

      expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
      expect(redirectMock).toHaveBeenCalledWith('/login')
    })

    it('failed signIn does not invalidate cache', async () => {
      const formData = new FormData()
      formData.append('email', 'user@example.test')
      formData.append('password', 'wrong')

      await expect(signIn(formData)).rejects.toThrow('NEXT_REDIRECT:/login?error=')

      expect(revalidatePathMock).not.toHaveBeenCalled()
    })
  })
})
