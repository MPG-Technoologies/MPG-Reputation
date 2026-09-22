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

let activeClient: ReturnType<typeof createClient<Database>>
let auditClient: ReturnType<typeof createClient<Database>>

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => auditClient),
}))

import { getSupportExceptionQueue } from '../../src/lib/support/exception-queue'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
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
let completionFailedA: string
let completionOtherA: string
let completionB: string

let failedRequestId: string
let ordinaryRequestId: string
let incompleteWebhookId: string
let retryingOutboxId: string
let staleOutboxId: string
let failedOutboxId: string

let failedTable: string | null = null
let auditFailure: 'returned' | 'thrown' | null = null
let removeGrantAfterReviewRead = false

const organizations: string[] = []
const requests: Array<{
  table: string
  method: string
  query: URLSearchParams
}> = []

function checked<
  T extends {
    data: unknown
    error: unknown
  },
>(result: T): T['data'] {
  if (result.error) {
    throw new Error(
      'Synthetic MR-6B fixture operation failed',
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

function minutesAgo(minutes: number): string {
  return new Date(
    Date.now() - minutes * 60_000
  ).toISOString()
}

describe(
  'MR-6B bounded operational exception queue',
  () => {
    beforeAll(async () => {
      expect(
        new URL(url).hostname
      ).toMatch(/^(127\.0\.0\.1|localhost)$/)

      const orgAResult = checked(
        await admin
          .from('organizations')
          .insert({
            name: 'MR6B Organization A',
            slug: `mr6b-a-${randomUUID()}`,
          })
          .select('id')
          .single()
      )!

      const orgBResult = checked(
        await admin
          .from('organizations')
          .insert({
            name: 'MR6B Organization B',
            slug: `mr6b-b-${randomUUID()}`,
          })
          .select('id')
          .single()
      )!

      orgA = orgAResult.id
      orgB = orgBResult.id
      organizations.push(orgA, orgB)

      const email =
        `mr6b-${randomUUID()}@example.test`
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
          'Missing synthetic MR-6B user'
        )
      }

      userId = user.id

      staffClient =
        createClient<Database>(
          url,
          process.env
            .NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            ...options,
            global: {
              fetch: async (input, init) => {
                const target =
                  requestUrl(input)

                const table =
                  target.pathname.split(
                    '/rest/v1/'
                  )[1]

                if (table) {
                  requests.push({
                    table,
                    method:
                      init?.method ?? 'GET',
                    query:
                      target.searchParams,
                  })

                  if (
                    table === failedTable
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
                  await fetch(input, init)

                if (
                  table ===
                    'review_requests' &&
                  removeGrantAfterReviewRead
                ) {
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

                  removeGrantAfterReviewRead =
                    false
                }

                return response
              },
            },
          }
        )

      checked(
        await staffClient.auth.signInWithPassword(
          {
            email,
            password,
          }
        )
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

      const locA = checked(
        await admin
          .from('locations')
          .insert({
            organization_id: orgA,
            name: 'MR6B Location A',
          })
          .select('id')
          .single()
      )!

      locationA = locA.id

      const locB = checked(
        await admin
          .from('locations')
          .insert({
            organization_id: orgB,
            name: 'MR6B Foreign Location',
          })
          .select('id')
          .single()
      )!

      locationB = locB.id

      const custA = checked(
        await admin
          .from('customers')
          .insert({
            organization_id: orgA,
            location_id: locationA,
            first_name: 'Private',
            last_name: 'Customer',
            email:
              'private-mr6b@example.test',
            permission_email: 'allowed',
          })
          .select('id')
          .single()
      )!

      customerA = custA.id

      const custB = checked(
        await admin
          .from('customers')
          .insert({
            organization_id: orgB,
            location_id: locationB,
            first_name: 'Foreign',
            last_name: 'Customer',
            email:
              'foreign-mr6b@example.test',
            permission_email: 'allowed',
          })
          .select('id')
          .single()
      )!

      customerB = custB.id

      const completionsA = checked(
        await admin
          .from(
            'customer_completion_events'
          )
          .insert([
            {
              organization_id: orgA,
              location_id: locationA,
              customer_id: customerA,
              source: 'mr6b-test',
              source_event_id:
                `failed-${randomUUID()}`,
            },
            {
              organization_id: orgA,
              location_id: locationA,
              customer_id: customerA,
              source: 'mr6b-test',
              source_event_id:
                `other-${randomUUID()}`,
            },
          ])
          .select('id')
      )!

      completionFailedA =
        completionsA[0].id
      completionOtherA =
        completionsA[1].id

      const foreignCompletion = checked(
        await admin
          .from(
            'customer_completion_events'
          )
          .insert({
            organization_id: orgB,
            location_id: locationB,
            customer_id: customerB,
            source: 'mr6b-test',
            source_event_id:
              `foreign-${randomUUID()}`,
          })
          .select('id')
          .single()
      )!

      completionB =
        foreignCompletion.id

      checked(
        await admin
          .from(
            'support_access_grants'
          )
          .insert({
            organization_id: orgA,
            user_id: userId,
            support_role: 'MPG_ADMIN',
            expires_at: new Date(
              Date.now() + 3_600_000
            ).toISOString(),
          })
      )

      // Foreign operational records must
      // never enter Org A's exception queue.
      const foreignRequest = checked(
        await admin
          .from('review_requests')
          .insert({
            organization_id: orgB,
            location_id: locationB,
            customer_id: customerB,
            completion_event_id:
              completionB,
            channel: 'email',
            status: 'FAILED',
            token:
              `foreign-${randomUUID()}`,
            token_hash:
              randomUUID().replaceAll(
                '-',
                ''
              ),
            failed_at:
              minutesAgo(60),
          })
          .select('id')
          .single()
      )!

      checked(
        await admin
          .from('message_events')
          .insert({
            organization_id: orgB,
            review_request_id:
              foreignRequest.id,
            provider: 'resend',
            provider_message_id:
              'foreign-private-message',
            provider_event_id:
              `foreign-${randomUUID()}`,
            event_type:
              'email.delivered',
            status: 'SENDING',
            sanitized_error:
              'foreign-private-error',
            processed_at: null,
            created_at:
              minutesAgo(60),
          })
      )

      checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .insert({
            organization_id: orgB,
            event_type:
              'foreign.private.event',
            aggregate_type:
              'customer_completion_event',
            aggregate_id:
              completionB,
            payload: {
              email:
                'foreign-private@example.test',
            },
            status: 'PENDING',
            attempt_count: 5,
            last_error:
              'foreign private failure',
            created_at:
              minutesAgo(60),
          })
      )
    }, 30_000)

    beforeEach(async () => {
      vi.restoreAllMocks()

      failedTable = null
      auditFailure = null
      removeGrantAfterReviewRead =
        false
      requests.length = 0

      activeClient = staffClient

      checked(
        await admin
          .from('organization_users')
          .upsert(
            {
              organization_id: orgA,
              user_id: userId,
              role: 'VIEWER',
            },
            {
              onConflict:
                'organization_id,user_id',
            }
          )
      )

      checked(
        await admin
          .from(
            'support_access_grants'
          )
          .upsert(
            {
              organization_id: orgA,
              user_id: userId,
              support_role: 'MPG_ADMIN',
              expires_at: new Date(
                Date.now() + 3_600_000
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
      )

      checked(
        await admin
          .from('review_requests')
          .delete()
          .eq(
            'organization_id',
            orgA
          )
      )

      checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .delete()
          .eq(
            'organization_id',
            orgA
          )
      )

      const failedRequest = checked(
        await admin
          .from('review_requests')
          .insert({
            organization_id: orgA,
            location_id: locationA,
            customer_id: customerA,
            completion_event_id:
              completionFailedA,
            channel: 'email',
            status: 'FAILED',
            token:
              `failed-${randomUUID()}`,
            token_hash:
              randomUUID().replaceAll(
                '-',
                ''
              ),
            failed_at:
              minutesAgo(40),
            error_message:
              'private-recipient@example.test https://private.example/error',
            created_at:
              minutesAgo(45),
          })
          .select('id')
          .single()
      )!

      failedRequestId =
        failedRequest.id

      const ordinaryRequest = checked(
        await admin
          .from('review_requests')
          .insert({
            organization_id: orgA,
            location_id: locationA,
            customer_id: customerA,
            completion_event_id:
              completionOtherA,
            channel: 'email',
            status: 'DELIVERED',
            token:
              `ordinary-${randomUUID()}`,
            token_hash:
              randomUUID().replaceAll(
                '-',
                ''
              ),
            delivered_at:
              minutesAgo(20),
            created_at:
              minutesAgo(30),
          })
          .select('id')
          .single()
      )!

      ordinaryRequestId =
        ordinaryRequest.id

      const incompleteWebhook =
        checked(
          await admin
            .from('message_events')
            .insert({
              organization_id: orgA,
              review_request_id:
                failedRequestId,
              provider: 'resend',
              provider_message_id:
                'private-provider-message-id',
              provider_event_id:
                `mr6b-${randomUUID()}`,
              event_type:
                'email.bounced',
              status: 'SENDING',
              sanitized_error:
                'private-recipient@example.test https://private.example/error',
              processed_at: null,
              created_at:
                minutesAgo(15),
            })
            .select('id')
            .single()
        )!

      incompleteWebhookId =
        incompleteWebhook.id

      // Recent incomplete webhook:
      // intentionally below the 5-minute
      // operational threshold.
      checked(
        await admin
          .from('message_events')
          .insert({
            organization_id: orgA,
            review_request_id:
              ordinaryRequestId,
            provider: 'resend',
            provider_event_id:
              `recent-${randomUUID()}`,
            event_type:
              'email.delivered',
            status: 'SENDING',
            processed_at: null,
            created_at:
              minutesAgo(1),
          })
      )

      // Completed webhook must not be
      // represented as an exception.
      checked(
        await admin
          .from('message_events')
          .insert({
            organization_id: orgA,
            review_request_id:
              ordinaryRequestId,
            provider: 'resend',
            provider_event_id:
              `processed-${randomUUID()}`,
            event_type:
              'email.delivered',
            status: 'DELIVERED',
            processed_at:
              minutesAgo(10),
            created_at:
              minutesAgo(11),
          })
      )

      const retrying = checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .insert({
            organization_id: orgA,
            event_type:
              'customer.completed',
            aggregate_type:
              'customer_completion_event',
            aggregate_id:
              completionFailedA,
            payload: {
              email:
                'private-recipient@example.test',
              token:
                'private-token',
            },
            status: 'PENDING',
            attempt_count: 2,
            last_error:
              'private-recipient@example.test provider timeout',
            created_at:
              minutesAgo(25),
          })
          .select('id')
          .single()
      )!

      retryingOutboxId =
        retrying.id

      const stale = checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .insert({
            organization_id: orgA,
            event_type:
              'customer.completed',
            aggregate_type:
              'customer_completion_event',
            aggregate_id:
              completionOtherA,
            payload: {
              private: true,
            },
            status: 'PENDING',
            attempt_count: 0,
            created_at:
              minutesAgo(20),
          })
          .select('id')
          .single()
      )!

      staleOutboxId = stale.id

      const failed = checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .insert({
            organization_id: orgA,
            event_type:
              'synthetic.failed',
            aggregate_type:
              'customer_completion_event',
            aggregate_id:
              completionFailedA,
            payload: {
              private: true,
            },
            status: 'FAILED',
            attempt_count: 4,
            last_error:
              'private raw failure',
            created_at:
              minutesAgo(50),
          })
          .select('id')
          .single()
      )!

      failedOutboxId = failed.id

      // Fresh untouched PENDING work
      // is normal, not yet exceptional.
      checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .insert({
            organization_id: orgA,
            event_type:
              'customer.completed',
            aggregate_type:
              'customer_completion_event',
            aggregate_id:
              completionOtherA,
            payload: {},
            status: 'PENDING',
            attempt_count: 0,
            created_at:
              minutesAgo(1),
          })
      )

      // Dispatched work is healthy history,
      // not an active exception.
      checked(
        await admin
          .from(
            'domain_event_outbox'
          )
          .insert({
            organization_id: orgA,
            event_type:
              'customer.completed',
            aggregate_type:
              'customer_completion_event',
            aggregate_id:
              completionOtherA,
            payload: {},
            status: 'DISPATCHED',
            attempt_count: 1,
            created_at:
              minutesAgo(40),
            dispatched_at:
              minutesAgo(39),
          })
      )

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

                expect(
                  target.pathname
                ).toBe(
                  '/rest/v1/audit_events'
                )

                expect(
                  init?.method
                ).toBe('POST')

                if (
                  auditFailure ===
                  'returned'
                ) {
                  return Response.json(
                    {
                      message:
                        'private audit error',
                    },
                    { status: 500 }
                  )
                }

                if (
                  auditFailure ===
                  'thrown'
                ) {
                  throw new Error(
                    'private audit exception'
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
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    afterAll(async () => {
      if (organizations.length) {
        checked(
          await admin
            .from('organizations')
            .delete()
            .in(
              'id',
              organizations
            )
        )
      }

      if (userId) {
        checked(
          await admin.auth.admin.deleteUser(
            userId
          )
        )
      }
    })

    it(
      'returns exactly the minimized exception DTO and classifies operational truth',
      async () => {
        const result =
          await getSupportExceptionQueue(
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
            'Missing MR-6B snapshot'
          )
        }

        expect(
          Object.keys(
            result.snapshot
          ).sort()
        ).toEqual([
          'outbox',
          'reviewRequests',
          'snapshotAt',
          'truncated',
          'webhooks',
        ])

        expect(
          result.snapshot.outbox.map(
            (item) => [
              item.id,
              item.kind,
            ]
          )
        ).toEqual(
          expect.arrayContaining([
            [
              retryingOutboxId,
              'RETRYING',
            ],
            [
              staleOutboxId,
              'STALE',
            ],
            [
              failedOutboxId,
              'FAILED',
            ],
          ])
        )

        expect(
          result.snapshot.webhooks
        ).toEqual([
          expect.objectContaining({
            id: incompleteWebhookId,
            kind: 'INCOMPLETE',
            provider: 'resend',
            eventType:
              'email.bounced',
            reviewRequestId:
              failedRequestId,
          }),
        ])

        expect(
          result.snapshot
            .reviewRequests
        ).toEqual([
          expect.objectContaining({
            id: failedRequestId,
            kind: 'FAILED',
            locationId:
              locationA,
            channel: 'email',
          }),
        ])

        expect(
          Number.isFinite(
            Date.parse(
              result.snapshot
                .snapshotAt
            )
          )
        ).toBe(true)

        expect(
          JSON.stringify(result)
        ).not.toMatch(
          /private-recipient|private-token|private raw|private-provider-message|https:\/\/private|"(?:payload|last_error|sanitized_error|error_message|token_hash|email|phone|first_name|last_name|contact)"\s*:/i
        )
      }
    )

    it(
      'does not surface fresh untouched, dispatched, processed or recent provider work',
      async () => {
        const result =
          await getSupportExceptionQueue(
            orgA
          )

        if (
          result.status !==
          'AVAILABLE'
        ) {
          throw new Error(
            'Missing MR-6B snapshot'
          )
        }

        expect(
          result.snapshot.outbox
        ).toHaveLength(3)

        expect(
          result.snapshot.webhooks
        ).toHaveLength(1)

        expect(
          result.snapshot
            .reviewRequests
        ).toHaveLength(1)
      }
    )

    it(
      'keeps every source query explicitly scoped to the authorized organization',
      async () => {
        expect(
          (
            await getSupportExceptionQueue(
              orgA
            )
          ).status
        ).toBe('AVAILABLE')

        const sourceReads =
          requests.filter((request) =>
            [
              'domain_event_outbox',
              'message_events',
              'review_requests',
            ].includes(
              request.table
            )
          )

        expect(
          sourceReads.length
        ).toBe(5)

        for (
          const request of sourceReads
        ) {
          expect(
            request.method
          ).toBe('GET')

          expect(
            request.query.get(
              'organization_id'
            )
          ).toBe(`eq.${orgA}`)
        }
      }
    )

    it(
      'truthfully bounds a source category and reports truncation',
      async () => {
        checked(
          await admin
            .from(
              'domain_event_outbox'
            )
            .delete()
            .eq(
              'organization_id',
              orgA
            )
        )

        checked(
          await admin
            .from(
              'domain_event_outbox'
            )
            .insert(
              Array.from(
                { length: 21 },
                (_, index) => ({
                  organization_id:
                    orgA,
                  event_type:
                    'customer.completed',
                  aggregate_type:
                    'customer_completion_event',
                  aggregate_id:
                    completionFailedA,
                  payload: {},
                  status:
                    'PENDING' as const,
                  attempt_count: 1,
                  created_at:
                    minutesAgo(
                      60 + index
                    ),
                })
              )
            )
        )

        const result =
          await getSupportExceptionQueue(
            orgA
          )

        if (
          result.status !==
          'AVAILABLE'
        ) {
          throw new Error(
            'Missing bounded snapshot'
          )
        }

        expect(
          result.snapshot.outbox
        ).toHaveLength(20)

        expect(
          result.snapshot.truncated
            .outbox
        ).toBe(true)
      }
    )

    it(
      'returns a truthful empty queue when no operational exceptions exist',
      async () => {
        checked(
          await admin
            .from(
              'domain_event_outbox'
            )
            .delete()
            .eq(
              'organization_id',
              orgA
            )
        )

        checked(
          await admin
            .from('review_requests')
            .delete()
            .eq(
              'organization_id',
              orgA
            )
        )

        const result =
          await getSupportExceptionQueue(
            orgA
          )

        if (
          result.status !==
          'AVAILABLE'
        ) {
          throw new Error(
            'Missing empty queue'
          )
        }

        expect(
          result.snapshot.outbox
        ).toEqual([])

        expect(
          result.snapshot.webhooks
        ).toEqual([])

        expect(
          result.snapshot
            .reviewRequests
        ).toEqual([])
      }
    )

    it.each([
      'domain_event_outbox',
      'message_events',
      'review_requests',
    ])(
      'returns UNAVAILABLE rather than false health when %s cannot be read',
      async (table) => {
        failedTable = table

        expect(
          await getSupportExceptionQueue(
            orgA
          )
        ).toEqual({
          status: 'UNAVAILABLE',
        })

        const audit = checked(
          await admin
            .from('audit_events')
            .select(
              'event_type,metadata'
            )
            .eq(
              'organization_id',
              orgA
            )
        )!

        expect(audit).toEqual([
          {
            event_type:
              'support.exception_queue_inspection',
            metadata: {
              outcome:
                'UNAVAILABLE',
            },
          },
        ])
      }
    )

    it(
      'writes a fixed AVAILABLE audit with the verified actor and organization',
      async () => {
        expect(
          (
            await getSupportExceptionQueue(
              orgA
            )
          ).status
        ).toBe('AVAILABLE')

        const rows = checked(
          await admin
            .from('audit_events')
            .select('*')
            .eq(
              'organization_id',
              orgA
            )
        )!

        expect(rows).toHaveLength(1)

        expect(
          rows[0]
        ).toMatchObject({
          actor_type: 'user',
          actor_id: userId,
          organization_id:
            orgA,
          event_type:
            'support.exception_queue_inspection',
          entity_type:
            'organization',
          entity_id: orgA,
          metadata: {
            outcome: 'AVAILABLE',
          },
        })
      }
    )

    it.each([
      'returned',
      'thrown',
    ] as const)(
      'withholds the queue when the mandatory audit %s failure occurs',
      async (failure) => {
        auditFailure = failure

        expect(
          await getSupportExceptionQueue(
            orgA
          )
        ).toEqual({
          status: 'UNAVAILABLE',
        })

        expect(
          checked(
            await admin
              .from('audit_events')
              .select('id')
              .eq(
                'organization_id',
                orgA
              )
          )
        ).toEqual([])
      }
    )

    it(
      'does not mutate operational source records during inspection',
      async () => {
        const readState =
          async () =>
            Promise.all([
              admin
                .from(
                  'domain_event_outbox'
                )
                .select('*')
                .eq(
                  'organization_id',
                  orgA
                )
                .order('id'),
              admin
                .from(
                  'message_events'
                )
                .select('*')
                .eq(
                  'organization_id',
                  orgA
                )
                .order('id'),
              admin
                .from(
                  'review_requests'
                )
                .select('*')
                .eq(
                  'organization_id',
                  orgA
                )
                .order('id'),
            ]).then(
              (results) =>
                results.map(checked)
            )

        const before =
          await readState()

        expect(
          (
            await getSupportExceptionQueue(
              orgA
            )
          ).status
        ).toBe('AVAILABLE')

        expect(
          await readState()
        ).toEqual(before)
      }
    )

    it(
      'denies a foreign organization without exposing its exceptions',
      async () => {
        expect(
          await getSupportExceptionQueue(
            orgB
          )
        ).toEqual({
          status: 'DENIED',
        })

        expect(
          checked(
            await admin
              .from('audit_events')
              .select('id')
              .eq(
                'organization_id',
                orgB
              )
          )
        ).toEqual([])
      }
    )

    it(
      'rechecks support authorization before auditing and returning the queue',
      async () => {
        removeGrantAfterReviewRead =
          true

        expect(
          await getSupportExceptionQueue(
            orgA
          )
        ).toEqual({
          status: 'DENIED',
        })

        expect(
          checked(
            await admin
              .from('audit_events')
              .select('id')
              .eq(
                'organization_id',
                orgA
              )
          )
        ).toEqual([])
      }
    )
  }
)
