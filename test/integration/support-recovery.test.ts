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
import {
  createClient,
} from '@supabase/supabase-js'
import type {
  Database,
  Json,
} from '../../src/types/database'
import type {
  Inngest,
} from 'inngest'

vi.mock(
  'server-only',
  () => ({})
)

let activeClient:
  ReturnType<
    typeof createClient<Database>
  >

let auditClient:
  ReturnType<
    typeof createClient<Database>
  >

vi.mock(
  '@/lib/supabase/server',
  () => ({
    createClient: vi.fn(
      async () => activeClient
    ),
  })
)

vi.mock(
  '@/lib/supabase/admin',
  () => ({
    createAdminClient: vi.fn(
      () => auditClient
    ),
  })
)

import {
  retrySupportOutboxEvent,
} from '../../src/lib/support/recovery'

const url =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL!

const anonKey =
  process.env
    .NEXT_PUBLIC_SUPABASE_ANON_KEY!

const serviceKey =
  process.env
    .SUPABASE_SERVICE_ROLE_KEY!

const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}

const admin =
  createClient<Database>(
    url,
    serviceKey,
    options
  )

type OutboxInsert = {
  id?: string
  organization_id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  payload: Json
  status?: 'PENDING' | 'DISPATCHED' | 'FAILED'
  attempt_count?: number
  last_error?: string | null
  created_at?: string
  dispatched_at?: string | null
}

let staffClient: typeof admin

let userId: string
let orgA: string
let orgB: string

let auditCallCount = 0
let failAuditCall:
  number | null = null

let removeGrantAfterOutboxRead =
  false

function checked<
  T extends {
    data: unknown
    error: unknown
  },
>(
  result: T
): T['data'] {
  if (result.error) {
    throw new Error(
      'Synthetic MR-6D fixture operation failed',
      {
        cause: result.error,
      }
    )
  }

  return result.data
}

function requestUrl(
  input:
    Parameters<typeof fetch>[0]
): URL {
  return new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  )
}

function minutesAgo(
  minutes: number
): string {
  return new Date(
    Date.now() -
      minutes *
        60 *
        1000
  ).toISOString()
}

async function insertOutbox(
  organizationId: string,
  overrides:
    Partial<OutboxInsert> = {}
): Promise<string> {
  const row:
    OutboxInsert = {
      organization_id:
        organizationId,
      event_type:
        'customer.completed',
      aggregate_type:
        'customer_completion_event',
      aggregate_id:
        randomUUID(),
      payload: {
        private:
          'must-never-surface',
      },
      status: 'PENDING',
      attempt_count: 0,
      created_at:
        minutesAgo(20),
      ...overrides,
    }

  const data = checked(
    await admin
      .from(
        'domain_event_outbox'
      )
      .insert(row)
      .select('id')
      .single()
  )!

  return data.id
}

async function readOutbox(
  id: string
) {
  return checked(
    await admin
      .from(
        'domain_event_outbox'
      )
      .select(
        'id,status,attempt_count,last_error,dispatched_at'
      )
      .eq('id', id)
      .single()
  )!
}

async function readRetryAudits() {
  return (
    checked(
      await admin
        .from('audit_events')
        .select(
          'organization_id,actor_id,event_type,entity_type,entity_id,metadata,created_at'
        )
        .eq(
          'organization_id',
          orgA
        )
        .eq(
          'event_type',
          'support.outbox_retry'
        )
        .order(
          'created_at',
          {
            ascending: true,
          }
        )
    ) ?? []
  )
}

async function restoreGrant() {
  checked(
    await admin
      .from(
        'support_access_grants'
      )
      .upsert(
        {
          organization_id:
            orgA,
          user_id:
            userId,
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
}

function successfulInngestHarness() {
  return {
    send: vi.fn(
      async () => ({
        ids: [
          `mr6d-${randomUUID()}`,
        ],
      })
    ),
  } as unknown as Inngest
}

describe(
  'MR-6D bounded audited support recovery',
  () => {
    beforeAll(
      async () => {
        expect(
          new URL(url).hostname
        ).toMatch(
          /^(127\.0\.0\.1|localhost)$/
        )

        const orgAData =
          checked(
            await admin
              .from(
                'organizations'
              )
              .insert({
                name:
                  'MR6D Organization A',
                slug:
                  `mr6d-a-${randomUUID()}`,
              })
              .select('id')
              .single()
          )!

        const orgBData =
          checked(
            await admin
              .from(
                'organizations'
              )
              .insert({
                name:
                  'MR6D Organization B',
                slug:
                  `mr6d-b-${randomUUID()}`,
              })
              .select('id')
              .single()
          )!

        orgA = orgAData.id
        orgB = orgBData.id

        const email =
          `mr6d-${randomUUID()}@example.test`

        const password =
          randomUUID()

        const userData =
          checked(
            await admin
              .auth
              .admin
              .createUser({
                email,
                password,
                email_confirm:
                  true,
              })
          )

        if (
          !userData.user
        ) {
          throw new Error(
            'Missing synthetic MR-6D support user'
          )
        }

        userId =
          userData.user.id

        auditClient =
          createClient<Database>(
            url,
            serviceKey,
            {
              ...options,
              global: {
                fetch:
                  async (
                    input,
                    init
                  ) => {
                    const target =
                      requestUrl(
                        input
                      )

                    if (
                      target.pathname
                        .includes(
                          '/rest/v1/audit_events'
                        ) &&
                      (
                        init?.method ??
                        'GET'
                      ).toUpperCase() ===
                        'POST'
                    ) {
                      auditCallCount++

                      if (
                        failAuditCall ===
                        auditCallCount
                      ) {
                        return Response.json(
                          {
                            message:
                              'synthetic private audit persistence failure',
                          },
                          {
                            status:
                              500,
                          }
                        )
                      }
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
            anonKey,
            {
              ...options,
              global: {
                fetch:
                  async (
                    input,
                    init
                  ) => {
                    const target =
                      requestUrl(
                        input
                      )

                    const response =
                      await fetch(
                        input,
                        init
                      )

                    if (
                      removeGrantAfterOutboxRead &&
                      response.ok &&
                      target.pathname
                        .includes(
                          '/rest/v1/domain_event_outbox'
                        )
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

        activeClient =
          staffClient

        checked(
          await staffClient
            .auth
            .signInWithPassword({
              email,
              password,
            })
        )

        checked(
          await admin
            .from(
              'organization_users'
            )
            .insert({
              organization_id:
                orgA,
              user_id:
                userId,
              role:
                'VIEWER',
            })
        )
      }
    )

    beforeEach(
      async () => {
        activeClient =
          staffClient

        auditCallCount = 0
        failAuditCall = null

        removeGrantAfterOutboxRead =
          false

        checked(
          await admin
            .from(
              'domain_event_outbox'
            )
            .delete()
            .in(
              'organization_id',
              [orgA, orgB]
            )
        )

        checked(
          await admin
            .from(
              'audit_events'
            )
            .delete()
            .eq(
              'organization_id',
              orgA
            )
            .eq(
              'event_type',
              'support.outbox_retry'
            )
        )

        await restoreGrant()
      }
    )

    afterEach(
      async () => {
        failAuditCall = null
        removeGrantAfterOutboxRead =
          false

        checked(
          await admin
            .from(
              'domain_event_outbox'
            )
            .delete()
            .in(
              'organization_id',
              [orgA, orgB]
            )
        )
      }
    )

    afterAll(
      async () => {
        if (orgA) {
          checked(
            await admin
              .from(
                'audit_events'
              )
              .delete()
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'support.outbox_retry'
              )
          )
        }

        if (
          orgA ||
          orgB
        ) {
          checked(
            await admin
              .from(
                'organizations'
              )
              .delete()
              .in(
                'id',
                [orgA, orgB]
              )
          )
        }

        if (userId) {
          const result =
            await admin
              .auth
              .admin
              .deleteUser(
                userId
              )

          if (result.error) {
            throw result.error
          }
        }
      }
    )

    it(
      'dispatches exactly one eligible target and leaves another eligible pending event untouched',
      async () => {
        const target =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                2,
              created_at:
                minutesAgo(
                  30
                ),
            }
          )

        const sibling =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                4,
              created_at:
                minutesAgo(
                  40
                ),
            }
          )

        const inngestClient =
          successfulInngestHarness()

        const send =
          inngestClient.send as
            unknown as
              ReturnType<
                typeof vi.fn
              >

        const result =
          await retrySupportOutboxEvent(
            orgA,
            target,
            {
              inngestClient,
            }
          )

        expect(
          result.status
        ).toBe(
          'DISPATCHED'
        )

        if (
          result.status !==
          'DISPATCHED'
        ) {
          throw new Error(
            'Expected dispatched support recovery'
          )
        }

        expect(
          result.actionId
        ).toMatch(
          /^[0-9a-f-]{36}$/i
        )

        expect(
          send
        ).toHaveBeenCalledTimes(
          1
        )

        expect(
          send
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            id: target,
            name:
              'customer.completed',
          })
        )

        const targetRow =
          await readOutbox(
            target
          )

        expect(
          targetRow.status
        ).toBe(
          'DISPATCHED'
        )

        expect(
          targetRow
            .attempt_count
        ).toBe(3)

        expect(
          targetRow
            .dispatched_at
        ).not.toBeNull()

        const siblingRow =
          await readOutbox(
            sibling
          )

        expect(
          siblingRow.status
        ).toBe(
          'PENDING'
        )

        expect(
          siblingRow
            .attempt_count
        ).toBe(4)

        const audits =
          await readRetryAudits()

        expect(
          audits
        ).toHaveLength(2)

        expect(
          audits.every(
            (row) =>
              row.entity_id ===
                target &&
              row.actor_id ===
                userId &&
              row.organization_id ===
                orgA
          )
        ).toBe(true)

        const metadata =
          audits.map(
            (row) =>
              row.metadata as
                Record<
                  string,
                  unknown
                >
          )

        const requestAudit =
          metadata.find(
            (value) =>
              value.phase ===
              'REQUEST'
          )

        const resultAudit =
          metadata.find(
            (value) =>
              value.phase ===
              'RESULT'
          )

        expect(
          requestAudit
        ).toMatchObject({
          actionId:
            result.actionId,
          phase: 'REQUEST',
          outcome:
            'REQUESTED',
        })

        expect(
          resultAudit
        ).toMatchObject({
          actionId:
            result.actionId,
          phase: 'RESULT',
          outcome:
            'DISPATCHED',
        })
      }
    )

    it(
      'rejects invalid, foreign, fresh and FAILED targets without dispatch',
      async () => {
        const foreign =
          await insertOutbox(
            orgB,
            {
              attempt_count:
                3,
            }
          )

        const fresh =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                0,
              created_at:
                minutesAgo(2),
            }
          )

        const failed =
          await insertOutbox(
            orgA,
            {
              status:
                'FAILED',
              attempt_count:
                5,
            }
          )

        const inngestClient =
          successfulInngestHarness()

        const send =
          inngestClient.send as
            unknown as
              ReturnType<
                typeof vi.fn
              >

        expect(
          await retrySupportOutboxEvent(
            orgA,
            'not-a-uuid',
            {
              inngestClient,
            }
          )
        ).toEqual({
          status:
            'NOT_ELIGIBLE',
        })

        expect(
          await retrySupportOutboxEvent(
            orgA,
            foreign,
            {
              inngestClient,
            }
          )
        ).toEqual({
          status:
            'NOT_ELIGIBLE',
        })

        expect(
          await retrySupportOutboxEvent(
            orgA,
            fresh,
            {
              inngestClient,
            }
          )
        ).toEqual({
          status:
            'NOT_ELIGIBLE',
        })

        expect(
          await retrySupportOutboxEvent(
            orgA,
            failed,
            {
              inngestClient,
            }
          )
        ).toEqual({
          status:
            'NOT_ELIGIBLE',
        })

        expect(
          send
        ).not
          .toHaveBeenCalled()

        expect(
          await readRetryAudits()
        ).toHaveLength(0)
      }
    )

    it(
      'fails closed without a current support grant',
      async () => {
        const target =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                1,
            }
          )

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

        const inngestClient =
          successfulInngestHarness()

        const send =
          inngestClient.send as
            unknown as
              ReturnType<
                typeof vi.fn
              >

        const result =
          await retrySupportOutboxEvent(
            orgA,
            target,
            {
              inngestClient,
            }
          )

        expect(
          result
        ).toEqual({
          status: 'DENIED',
        })

        expect(
          send
        ).not
          .toHaveBeenCalled()

        const row =
          await readOutbox(
            target
          )

        expect(
          row.status
        ).toBe(
          'PENDING'
        )

        expect(
          row.attempt_count
        ).toBe(1)
      }
    )

    it(
      'requires the REQUEST audit to persist before mutation',
      async () => {
        const target =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                2,
            }
          )

        failAuditCall = 1

        const inngestClient =
          successfulInngestHarness()

        const send =
          inngestClient.send as
            unknown as
              ReturnType<
                typeof vi.fn
              >

        const result =
          await retrySupportOutboxEvent(
            orgA,
            target,
            {
              inngestClient,
            }
          )

        expect(
          result
        ).toEqual({
          status:
            'UNAVAILABLE',
        })

        expect(
          send
        ).not
          .toHaveBeenCalled()

        const row =
          await readOutbox(
            target
          )

        expect(
          row.status
        ).toBe(
          'PENDING'
        )

        expect(
          row.attempt_count
        ).toBe(2)

        expect(
          await readRetryAudits()
        ).toHaveLength(0)
      }
    )

    it(
      'rechecks authorization after inspection and request audit before mutation',
      async () => {
        const target =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                1,
            }
          )

        removeGrantAfterOutboxRead =
          true

        const inngestClient =
          successfulInngestHarness()

        const send =
          inngestClient.send as
            unknown as
              ReturnType<
                typeof vi.fn
              >

        const result =
          await retrySupportOutboxEvent(
            orgA,
            target,
            {
              inngestClient,
            }
          )

        expect(
          result
        ).toEqual({
          status:
            'DENIED',
        })

        expect(
          send
        ).not
          .toHaveBeenCalled()

        const row =
          await readOutbox(
            target
          )

        expect(
          row.status
        ).toBe(
          'PENDING'
        )

        expect(
          row.attempt_count
        ).toBe(1)

        const audits =
          await readRetryAudits()

        expect(
          audits
        ).toHaveLength(2)

        const outcomes =
          audits.map(
            (row) =>
              (
                row.metadata as
                  Record<
                    string,
                    unknown
                  >
              ).outcome
          )

        expect(
          outcomes
        ).toContain(
          'REQUESTED'
        )

        expect(
          outcomes
        ).toContain(
          'AUTHORIZATION_CHANGED'
        )
      }
    )

    it(
      'returns RETRY_FAILED without leaking the provider error when dispatch fails',
      async () => {
        const target =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                3,
            }
          )

        const privateError =
          'private-provider-secret-DO-NOT-RETURN'

        const send =
          vi.fn(
            async () => {
              throw new Error(
                privateError
              )
            }
          )

        const inngestClient =
          {
            send,
          } as unknown as
            Inngest

        const result =
          await retrySupportOutboxEvent(
            orgA,
            target,
            {
              inngestClient,
            }
          )

        expect(
          result.status
        ).toBe(
          'RETRY_FAILED'
        )

        expect(
          JSON.stringify(
            result
          )
        ).not.toContain(
          privateError
        )

        const row =
          await readOutbox(
            target
          )

        expect(
          row.status
        ).toBe(
          'PENDING'
        )

        expect(
          row.attempt_count
        ).toBe(4)

        const audits =
          await readRetryAudits()

        expect(
          JSON.stringify(
            audits
          )
        ).not.toContain(
          privateError
        )

        expect(
          audits.some(
            (row) =>
              (
                row.metadata as
                  Record<
                    string,
                    unknown
                  >
              ).outcome ===
              'RETRY_FAILED'
          )
        ).toBe(true)
      }
    )

    it(
      'reports OUTCOME_UNAVAILABLE when dispatch succeeds but mandatory result audit fails',
      async () => {
        const target =
          await insertOutbox(
            orgA,
            {
              attempt_count:
                1,
            }
          )

        failAuditCall = 2

        const inngestClient =
          successfulInngestHarness()

        const result =
          await retrySupportOutboxEvent(
            orgA,
            target,
            {
              inngestClient,
            }
          )

        expect(
          result.status
        ).toBe(
          'OUTCOME_UNAVAILABLE'
        )

        if (
          result.status !==
          'OUTCOME_UNAVAILABLE'
        ) {
          throw new Error(
            'Expected outcome unavailable'
          )
        }

        expect(
          result.actionId
        ).toMatch(
          /^[0-9a-f-]{36}$/i
        )

        const row =
          await readOutbox(
            target
          )

        expect(
          row.status
        ).toBe(
          'DISPATCHED'
        )

        expect(
          row.attempt_count
        ).toBe(2)

        const audits =
          await readRetryAudits()

        expect(
          audits
        ).toHaveLength(1)

        expect(
          audits[0].metadata
        ).toMatchObject({
          actionId:
            result.actionId,
          phase: 'REQUEST',
          outcome:
            'REQUESTED',
        })
      }
    )
  }
)
