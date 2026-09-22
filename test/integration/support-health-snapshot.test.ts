import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

vi.mock('server-only', () => ({}))

let activeClient:
  ReturnType<typeof createClient<Database>>

let auditClient:
  ReturnType<typeof createClient<Database>>

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(
    async () => activeClient
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(
    () => auditClient
  ),
}))

import {
  getSupportHealthSnapshot,
} from '../../src/lib/support/health-snapshot'

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL!

const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}

const admin = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  options
)

let staffClient: typeof admin

let userId: string
let orgA: string
let orgB: string
let locationA: string
let locationB: string
let customerA: string
let customerB: string
let completionA: string
let completionB: string
let reviewRequestA: string
let reviewRequestB: string

let failedTable: string | null = null
let auditFailure:
  | 'returned'
  | 'thrown'
  | null = null

let removeGrantAfterOutboxRead = false

const requests: Array<{
  table: string
}> = []

function checked<
  T extends {
    data: unknown
    error: unknown
  },
>(result: T): T['data'] {
  if (result.error) {
    throw new Error(
      'Synthetic MR-6C fixture operation failed',
      { cause: result.error }
    )
  }

  return result.data
}

function requestUrl(
  input: Parameters<typeof fetch>[0]
): URL {
  return new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  )
}

function hoursAgo(
  hours: number
): string {
  return new Date(
    Date.now() -
      hours * 60 * 60 * 1000
  ).toISOString()
}

function minutesAgo(
  minutes: number
): string {
  return new Date(
    Date.now() -
      minutes * 60 * 1000
  ).toISOString()
}

function configureConsoleMode() {
  vi.stubEnv(
    'EMAIL_PROVIDER',
    'console'
  )
  vi.stubEnv(
    'ENABLE_LIVE_EMAIL',
    'false'
  )
  vi.stubEnv(
    'RESEND_API_KEY',
    ''
  )
  vi.stubEnv(
    'EMAIL_FROM_ADDRESS',
    ''
  )
  vi.stubEnv(
    'RESEND_WEBHOOK_SECRET',
    ''
  )
}

describe(
  'MR-6C truthful support health snapshot',
  () => {
    beforeAll(async () => {
      expect(
        new URL(url).hostname
      ).toMatch(
        /^(127\.0\.0\.1|localhost)$/
      )

      const orgAData = checked(
        await admin
          .from('organizations')
          .insert({
            name: 'MR6C Organization A',
            slug:
              `mr6c-a-${randomUUID()}`,
          })
          .select('id')
          .single()
      )!

      const orgBData = checked(
        await admin
          .from('organizations')
          .insert({
            name: 'MR6C Organization B',
            slug:
              `mr6c-b-${randomUUID()}`,
          })
          .select('id')
          .single()
      )!

      orgA = orgAData.id
      orgB = orgBData.id

      const email =
        `mr6c-${randomUUID()}@example.test`
      const password = randomUUID()

      const { user } = checked(
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
      )

      if (!user) {
        throw new Error(
          'Missing synthetic MR-6C user'
        )
      }

      userId = user.id

      auditClient =
        createClient<Database>(
          url,
          process.env
            .SUPABASE_SERVICE_ROLE_KEY!,
          {
            ...options,
            global: {
              fetch: async (
                input,
                init
              ) => {
                const target =
                  requestUrl(input)

                if (
                  target.pathname.includes(
                    '/rest/v1/audit_events'
                  ) &&
                  auditFailure
                ) {
                  if (
                    auditFailure ===
                    'thrown'
                  ) {
                    throw new Error(
                      'synthetic audit transport failure'
                    )
                  }

                  return Response.json(
                    {
                      message:
                        'synthetic audit persistence failure',
                    },
                    { status: 500 }
                  )
                }

                return fetch(
                  input,
                  init
                )
              },
            },
          }
        )

      staffClient =
        createClient<Database>(
          url,
          process.env
            .NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            ...options,
            global: {
              fetch: async (
                input,
                init
              ) => {
                const target =
                  requestUrl(input)

                const table =
                  target.pathname
                    .split(
                      '/rest/v1/'
                    )[1]

                if (table) {
                  requests.push({
                    table,
                  })

                  if (
                    table ===
                    failedTable
                  ) {
                    return Response.json(
                      {
                        message:
                          'private synthetic database detail',
                      },
                      { status: 500 }
                    )
                  }
                }

                const response =
                  await fetch(
                    input,
                    init
                  )

                if (
                  table ===
                    'domain_event_outbox' &&
                  removeGrantAfterOutboxRead &&
                  response.ok
                ) {
                  removeGrantAfterOutboxRead =
                    false

                  checked(
                    await admin
                      .from(
                        'support_access_grants'
                      )
                      .delete()
                      .eq(
                        'organization_id',
                        orgA
                      )
                      .eq(
                        'user_id',
                        userId
                      )
                  )
                }

                return response
              },
            },
          }
        )

      activeClient = staffClient

      checked(
        await staffClient.auth
          .signInWithPassword({
            email,
            password,
          })
      )

      checked(
        await admin
          .from('organization_users')
          .insert({
            organization_id: orgA,
            user_id: userId,
            role: 'VIEWER',
          })
      )

      const locationAData =
        checked(
          await admin
            .from('locations')
            .insert({
              organization_id: orgA,
              name:
                'MR6C Location A',
            })
            .select('id')
            .single()
        )!

      const locationBData =
        checked(
          await admin
            .from('locations')
            .insert({
              organization_id: orgB,
              name:
                'MR6C Foreign Location',
            })
            .select('id')
            .single()
        )!

      locationA =
        locationAData.id
      locationB =
        locationBData.id

      const customerAData =
        checked(
          await admin
            .from('customers')
            .insert({
              organization_id: orgA,
              location_id: locationA,
              first_name:
                'PrivateMR6C',
              last_name:
                'Customer',
              email:
                'private-mr6c@example.test',
              phone:
                '+15555550123',
              permission_email:
                'allowed',
            })
            .select('id')
            .single()
        )!

      const customerBData =
        checked(
          await admin
            .from('customers')
            .insert({
              organization_id: orgB,
              location_id: locationB,
              first_name:
                'ForeignMR6C',
              email:
                'foreign-mr6c@example.test',
              permission_email:
                'allowed',
            })
            .select('id')
            .single()
        )!

      customerA =
        customerAData.id
      customerB =
        customerBData.id

      const completionAData =
        checked(
          await admin
            .from(
              'customer_completion_events'
            )
            .insert({
              organization_id: orgA,
              location_id: locationA,
              customer_id: customerA,
              source: 'mr6c',
              source_event_id:
                `mr6c-a-${randomUUID()}`,
            })
            .select('id')
            .single()
        )!

      const completionBData =
        checked(
          await admin
            .from(
              'customer_completion_events'
            )
            .insert({
              organization_id: orgB,
              location_id: locationB,
              customer_id: customerB,
              source: 'mr6c',
              source_event_id:
                `mr6c-b-${randomUUID()}`,
            })
            .select('id')
            .single()
        )!

      completionA =
        completionAData.id
      completionB =
        completionBData.id

      const requestAData =
        checked(
          await admin
            .from('review_requests')
            .insert({
              organization_id: orgA,
              location_id: locationA,
              customer_id: customerA,
              completion_event_id:
                completionA,
              channel: 'email',
              status: 'SENT',
              token:
                `mr6c-token-${randomUUID()}`,
              token_hash:
                randomUUID(),
            })
            .select('id')
            .single()
        )!

      const requestBData =
        checked(
          await admin
            .from('review_requests')
            .insert({
              organization_id: orgB,
              location_id: locationB,
              customer_id: customerB,
              completion_event_id:
                completionB,
              channel: 'email',
              status: 'SENT',
              token:
                `mr6c-token-${randomUUID()}`,
              token_hash:
                randomUUID(),
            })
            .select('id')
            .single()
        )!

      reviewRequestA =
        requestAData.id
      reviewRequestB =
        requestBData.id

      checked(
        await admin
          .from('message_events')
          .insert([
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'console',
              provider_message_id:
                `console-${randomUUID()}`,
              event_type: 'sent',
              status: 'SENT',
              created_at:
                hoursAgo(1),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              event_type: 'sent',
              status: 'SENT',
              created_at:
                hoursAgo(2),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.delivered',
              status: 'DELIVERED',
              event_occurred_at:
                hoursAgo(2),
              processed_at:
                hoursAgo(2),
              created_at:
                hoursAgo(2),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.bounced',
              status: 'FAILED',
              event_occurred_at:
                hoursAgo(3),
              processed_at:
                hoursAgo(3),
              created_at:
                hoursAgo(3),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.delivery_delayed',
              status: 'SENDING',
              event_occurred_at:
                minutesAgo(15),
              processed_at: null,
              created_at:
                minutesAgo(15),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.complained',
              status: 'DELIVERED',
              event_occurred_at:
                hoursAgo(30),
              processed_at:
                hoursAgo(30),
              created_at:
                hoursAgo(30),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.failed',
              status: 'FAILED',
              event_occurred_at:
                hoursAgo(48),
              processed_at:
                hoursAgo(48),
              created_at:
                hoursAgo(48),
            },
            {
              organization_id: orgA,
              review_request_id:
                reviewRequestA,
              provider: 'resend',
              provider_message_id:
                `resend-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.suppressed',
              status: 'SUPPRESSED',
              event_occurred_at:
                hoursAgo(192),
              processed_at:
                hoursAgo(192),
              created_at:
                hoursAgo(192),
            },
            {
              organization_id: orgB,
              review_request_id:
                reviewRequestB,
              provider: 'resend',
              provider_message_id:
                `foreign-${randomUUID()}`,
              event_type: 'sent',
              status: 'SENT',
              created_at:
                hoursAgo(1),
            },
            {
              organization_id: orgB,
              review_request_id:
                reviewRequestB,
              provider: 'resend',
              provider_message_id:
                `foreign-${randomUUID()}`,
              provider_event_id:
                `evt-${randomUUID()}`,
              event_type:
                'email.delivered',
              status: 'DELIVERED',
              processed_at:
                hoursAgo(1),
              created_at:
                hoursAgo(1),
            },
          ])
      )

      checked(
        await admin
          .from('domain_event_outbox')
          .insert([
            {
              organization_id: orgA,
              event_type:
                'customer.completed',
              aggregate_type:
                'customer_completion_event',
              aggregate_id:
                completionA,
              payload: {
                private:
                  'must-never-surface',
              },
              status: 'PENDING',
              attempt_count: 0,
              last_error:
                'private fresh error',
              created_at:
                minutesAgo(2),
            },
            {
              organization_id: orgA,
              event_type:
                'customer.completed',
              aggregate_type:
                'customer_completion_event',
              aggregate_id:
                completionA,
              payload: {
                private:
                  'must-never-surface',
              },
              status: 'PENDING',
              attempt_count: 0,
              last_error:
                'private stale error',
              created_at:
                minutesAgo(20),
            },
            {
              organization_id: orgA,
              event_type:
                'customer.completed',
              aggregate_type:
                'customer_completion_event',
              aggregate_id:
                completionA,
              payload: {
                private:
                  'must-never-surface',
              },
              status: 'PENDING',
              attempt_count: 2,
              last_error:
                'private retry error',
              created_at:
                minutesAgo(30),
            },
            {
              organization_id: orgA,
              event_type:
                'customer.completed',
              aggregate_type:
                'customer_completion_event',
              aggregate_id:
                completionA,
              payload: {},
              status: 'DISPATCHED',
              attempt_count: 1,
              dispatched_at:
                minutesAgo(39),
              created_at:
                minutesAgo(40),
            },
            {
              organization_id: orgA,
              event_type:
                'customer.completed',
              aggregate_type:
                'customer_completion_event',
              aggregate_id:
                completionA,
              payload: {},
              status: 'FAILED',
              attempt_count: 3,
              last_error:
                'private failed error',
              created_at:
                minutesAgo(50),
            },
            {
              organization_id: orgB,
              event_type:
                'customer.completed',
              aggregate_type:
                'customer_completion_event',
              aggregate_id:
                completionB,
              payload: {},
              status: 'PENDING',
              attempt_count: 9,
              last_error:
                'foreign private error',
              created_at:
                minutesAgo(60),
            },
          ])
      )
    })

    beforeEach(async () => {
      activeClient = staffClient

      failedTable = null
      auditFailure = null
      removeGrantAfterOutboxRead =
        false
      requests.length = 0

      configureConsoleMode()

      checked(
        await admin
          .from(
            'support_access_grants'
          )
          .upsert(
            {
              organization_id: orgA,
              user_id: userId,
              support_role:
                'MPG_ADMIN',
              expires_at:
                new Date(
                  Date.now() +
                    4 *
                      60 *
                      60 *
                      1000
                ).toISOString(),
              revoked_at: null,
            },
            {
              onConflict:
                'organization_id,user_id',
            }
          )
      )

      checked(
        await admin
          .from('audit_events')
          .delete()
          .eq(
            'organization_id',
            orgA
          )
          .eq(
            'event_type',
            'support.health_snapshot_inspection'
          )
      )
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    afterAll(async () => {
      if (orgA || orgB) {
        checked(
          await admin
            .from('organizations')
            .delete()
            .in(
              'id',
              [orgA, orgB]
            )
        )
      }

      if (userId) {
        const result =
          await admin.auth.admin
            .deleteUser(userId)

        if (result.error) {
          throw result.error
        }
      }
    })

    it(
      'returns factual 24-hour and 7-day messaging and outbox telemetry without sensitive source data',
      async () => {
        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result.status
        ).toBe('AVAILABLE')

        if (
          result.status !==
          'AVAILABLE'
        ) {
          throw new Error(
            'Expected available health snapshot'
          )
        }

        expect(
          result.snapshot.messaging
        ).toEqual({
          mode: 'CONSOLE',
          providerIntent:
            'CONSOLE',
          liveEmailEnabled:
            false,
          apiKeyConfigured:
            false,
          fromAddressConfigured:
            false,
          webhookVerificationConfigured:
            false,
        })

        expect(
          result.snapshot.last24Hours
        ).toEqual({
          windowHours: 24,
          sendRecords: {
            allProviders: 2,
            resend: 1,
          },
          providerEvents: {
            delivered: 1,
            deliveryDelayed: 1,
            bounced: 1,
            complained: 0,
            failed: 0,
            suppressed: 0,
          },
          incompletePersistedWebhooks:
            1,
        })

        expect(
          result.snapshot.last7Days
        ).toEqual({
          windowHours: 168,
          sendRecords: {
            allProviders: 2,
            resend: 1,
          },
          providerEvents: {
            delivered: 1,
            deliveryDelayed: 1,
            bounced: 1,
            complained: 1,
            failed: 1,
            suppressed: 0,
          },
          incompletePersistedWebhooks:
            1,
        })

        expect(
          result.snapshot.outbox
        ).toMatchObject({
          pendingUntouched: 2,
          retrying: 1,
          staleUntouched: 1,
          dispatched: 1,
          failed: 1,
        })

        expect(
          result.snapshot.outbox
            .oldestPendingAgeMinutes
        ).toBeGreaterThanOrEqual(29)

        expect(
          result.snapshot.outbox
            .oldestPendingAgeMinutes
        ).toBeLessThanOrEqual(32)

        expect(
          result.snapshot
            .deliverabilityRatios
        ).toEqual({
          status: 'UNKNOWN',
          reason:
            'COHORT_SAFE_DENOMINATOR_NOT_CALCULATED',
        })

        const serialized =
          JSON.stringify(
            result.snapshot
          )

        expect(
          serialized
        ).not.toContain(
          'private-mr6c@example.test'
        )

        expect(
          serialized
        ).not.toContain(
          '+15555550123'
        )

        expect(
          serialized
        ).not.toContain(
          'must-never-surface'
        )

        expect(
          serialized
        ).not.toContain(
          'private retry error'
        )

        expect(
          serialized
        ).not.toContain(
          'foreign private error'
        )

        const tables =
          new Set(
            requests.map(
              request =>
                request.table
            )
          )

        expect(
          tables.has('customers')
        ).toBe(false)

        expect(
          tables.has(
            'customer_completion_events'
          )
        ).toBe(false)

        expect(
          tables.has(
            'review_requests'
          )
        ).toBe(false)
      }
    )

    it.each([
      {
        name:
          'configured resend with live sending disabled',
        provider: 'resend',
        live: 'false',
        apiKey: 're_test_key',
        from:
          'reviews@example.test',
        webhook: 'whsec_test',
        expected:
          'LIVE_EMAIL_DISABLED',
      },
      {
        name:
          'fully configured live resend sender',
        provider: 'resend',
        live: 'true',
        apiKey: 're_test_key',
        from:
          'reviews@example.test',
        webhook: 'whsec_test',
        expected:
          'LIVE_RESEND_CONFIGURED',
      },
      {
        name:
          'incomplete resend configuration',
        provider: 'resend',
        live: 'true',
        apiKey: 're_test_key',
        from: '',
        webhook: 'whsec_test',
        expected:
          'CONFIGURATION_INCOMPLETE',
      },
      {
        name:
          'unsupported provider intent',
        provider: 'other',
        live: 'true',
        apiKey: '',
        from: '',
        webhook: '',
        expected:
          'CONFIGURATION_INCOMPLETE',
      },
    ])(
      'reports $name without exposing configuration secrets',
      async ({
        provider,
        live,
        apiKey,
        from,
        webhook,
        expected,
      }) => {
        vi.stubEnv(
          'EMAIL_PROVIDER',
          provider
        )
        vi.stubEnv(
          'ENABLE_LIVE_EMAIL',
          live
        )
        vi.stubEnv(
          'RESEND_API_KEY',
          apiKey
        )
        vi.stubEnv(
          'EMAIL_FROM_ADDRESS',
          from
        )
        vi.stubEnv(
          'RESEND_WEBHOOK_SECRET',
          webhook
        )

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result.status
        ).toBe('AVAILABLE')

        if (
          result.status !==
          'AVAILABLE'
        ) {
          throw new Error(
            'Expected available health snapshot'
          )
        }

        expect(
          result.snapshot
            .messaging.mode
        ).toBe(expected)

        const serialized =
          JSON.stringify(
            result.snapshot.messaging
          )

        expect(
          serialized
        ).not.toContain(
          're_test_key'
        )

        expect(
          serialized
        ).not.toContain(
          'whsec_test'
        )

        expect(
          serialized
        ).not.toContain(
          'reviews@example.test'
        )
      }
    )

    it(
      'fails closed as UNAVAILABLE when a required source cannot be read and records that outcome',
      async () => {
        failedTable =
          'message_events'

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result
        ).toEqual({
          status: 'UNAVAILABLE',
        })

        const audit = checked(
          await admin
            .from('audit_events')
            .select(
              'actor_id,event_type,metadata'
            )
            .eq(
              'organization_id',
              orgA
            )
            .eq(
              'event_type',
              'support.health_snapshot_inspection'
            )
            .single()
        )!

        expect(
          audit.actor_id
        ).toBe(userId)

        expect(
          audit.metadata
        ).toMatchObject({
          outcome:
            'UNAVAILABLE',
        })
      }
    )

    it(
      'withholds the snapshot when mandatory audit persistence fails',
      async () => {
        auditFailure =
          'returned'

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result
        ).toEqual({
          status: 'UNAVAILABLE',
        })

        const auditRows =
          checked(
            await admin
              .from('audit_events')
              .select('id')
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'support.health_snapshot_inspection'
              )
          )!

        expect(
          auditRows
        ).toHaveLength(0)
      }
    )

    it(
      'withholds the snapshot when mandatory audit transport throws',
      async () => {
        auditFailure =
          'thrown'

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result
        ).toEqual({
          status: 'UNAVAILABLE',
        })
      }
    )

    it(
      'reauthorizes after reads and denies when the support grant disappears during inspection',
      async () => {
        removeGrantAfterOutboxRead =
          true

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result
        ).toEqual({
          status: 'DENIED',
        })
      }
    )

    it(
      'denies an otherwise authenticated tenant member without the explicit support grant',
      async () => {
        checked(
          await admin
            .from(
              'support_access_grants'
            )
            .delete()
            .eq(
              'organization_id',
              orgA
            )
            .eq(
              'user_id',
              userId
            )
        )

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result
        ).toEqual({
          status: 'DENIED',
        })
      }
    )

    it(
      'does not disclose a foreign organization without membership and support authorization',
      async () => {
        const result =
          await getSupportHealthSnapshot(
            orgB
          )

        expect(
          result
        ).toEqual({
          status: 'DENIED',
        })
      }
    )

    it(
      'writes a fixed AVAILABLE audit using the verified actor and organization',
      async () => {
        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result.status
        ).toBe('AVAILABLE')

        const audit = checked(
          await admin
            .from('audit_events')
            .select(
              'organization_id,actor_type,actor_id,event_type,entity_type,entity_id,metadata'
            )
            .eq(
              'organization_id',
              orgA
            )
            .eq(
              'event_type',
              'support.health_snapshot_inspection'
            )
            .single()
        )!

        expect(
          audit
        ).toMatchObject({
          organization_id:
            orgA,
          actor_type: 'user',
          actor_id: userId,
          event_type:
            'support.health_snapshot_inspection',
          entity_type:
            'organization',
          entity_id: orgA,
          metadata: {
            outcome: 'AVAILABLE',
          },
        })
      }
    )

    it(
      'does not mutate operational message or outbox records during inspection',
      async () => {
        const beforeMessages =
          checked(
            await admin
              .from('message_events')
              .select(
                'id,status,processed_at'
              )
              .eq(
                'organization_id',
                orgA
              )
              .order('id')
          )!

        const beforeOutbox =
          checked(
            await admin
              .from(
                'domain_event_outbox'
              )
              .select(
                'id,status,attempt_count,dispatched_at'
              )
              .eq(
                'organization_id',
                orgA
              )
              .order('id')
          )!

        const result =
          await getSupportHealthSnapshot(
            orgA
          )

        expect(
          result.status
        ).toBe('AVAILABLE')

        const afterMessages =
          checked(
            await admin
              .from('message_events')
              .select(
                'id,status,processed_at'
              )
              .eq(
                'organization_id',
                orgA
              )
              .order('id')
          )!

        const afterOutbox =
          checked(
            await admin
              .from(
                'domain_event_outbox'
              )
              .select(
                'id,status,attempt_count,dispatched_at'
              )
              .eq(
                'organization_id',
                orgA
              )
              .order('id')
          )!

        expect(
          afterMessages
        ).toEqual(
          beforeMessages
        )

        expect(
          afterOutbox
        ).toEqual(
          beforeOutbox
        )
      }
    )
  }
)
