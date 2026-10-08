import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { hashSuppressionContact } from '../../src/domain/suppression'

vi.mock('server-only', () => ({}))

let activeClient: SupabaseClient<Database>
let privilegedClient: SupabaseClient<Database>

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => activeClient),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => privilegedClient),
}))

import {
  CUSTOMER_PRIVACY_EXPORT_SCHEMA_VERSION,
  getCustomerPrivacyExport,
} from '../../src/domain/privacy/customer-export'

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'http://127.0.0.1:54331'

const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'dummy_anon_key'

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'dummy_service_role_key'

const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}

const isLocalDatabase =
  serviceRoleKey !== 'dummy_service_role_key' &&
  /^(127\.0\.0\.1|localhost)$/.test(
    new URL(url).hostname
  )

type Role =
  | 'OWNER'
  | 'ADMIN'
  | 'OPERATOR'
  | 'VIEWER'

function tableFromRequest(
  input: Parameters<typeof fetch>[0]
): string | null {
  const requestUrl = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  )

  const marker = '/rest/v1/'
  const index =
    requestUrl.pathname.indexOf(marker)

  if (index < 0) return null

  return requestUrl.pathname.slice(
    index + marker.length
  )
}

describe.skipIf(
  !isLocalDatabase
)(
  'MR-7C.2 customer privacy export',
  () => {
    const admin =
      createClient<Database>(
        url,
        serviceRoleKey,
        options
      )

    const orgIds: string[] = []
    const userIds: string[] = []

    let orgA: string
    let orgB: string
    let locA: string
    let locB: string

    let ownerId: string
    let adminId: string
    let operatorId: string
    let viewerId: string
    let ownerBId: string

    let ownerClient:
      SupabaseClient<Database>

    let adminUserClient:
      SupabaseClient<Database>

    let operatorClient:
      SupabaseClient<Database>

    let viewerClient:
      SupabaseClient<Database>

    let ownerBClient:
      SupabaseClient<Database>

    let customerA: string
    let customerB: string
    let completionA: string
    let reviewA: string

    let failedReadTable:
      string | null = null

    let failAudit = false

    let removeMembershipAfterTable:
      string | null = null

    let membershipRemoved = false

    async function checked<T>(
      result:
        | PromiseLike<{
            data: T
            error: unknown
          }>
        | {
            data: T
            error: unknown
          }
    ): Promise<T> {
      const resolved =
        await result

      if (resolved.error) {
        throw new Error(
          'Synthetic privacy-export fixture failed',
          {
            cause:
              resolved.error,
          }
        )
      }

      return resolved.data
    }

    async function createUser(
      prefix: string
    ) {
      const password =
        randomUUID()

      const email =
        `${prefix}-${randomUUID()}@example.test`

      const result =
        await admin.auth.admin.createUser(
          {
            email,
            password,
            email_confirm: true,
          }
        )

      if (
        result.error ||
        !result.data.user
      ) {
        throw new Error(
          `Failed to create ${prefix} user`
        )
      }

      userIds.push(
        result.data.user.id
      )

      const client =
        createClient<Database>(
          url,
          anonKey,
          {
            ...options,

            global: {
              fetch: async (
                input,
                init
              ) => {
                const table =
                  tableFromRequest(
                    input
                  )

                const method =
                  init?.method ??
                  'GET'

                if (
                  table &&
                  failedReadTable ===
                    table &&
                  method === 'GET'
                ) {
                  return Response.json(
                    {
                      message:
                        'synthetic read failure',
                    },
                    {
                      status: 500,
                    }
                  )
                }

                const response =
                  await fetch(
                    input,
                    init
                  )

                if (
                  table &&
                  removeMembershipAfterTable ===
                    table &&
                  !membershipRemoved &&
                  method === 'GET'
                ) {
                  membershipRemoved =
                    true

                  await admin
                    .from(
                      'organization_users'
                    )
                    .delete()
                    .eq(
                      'organization_id',
                      orgA
                    )
                    .eq(
                      'user_id',
                      ownerId
                    )
                }

                return response
              },
            },
          }
        )

      const signIn =
        await client.auth
          .signInWithPassword(
            {
              email,
              password,
            }
          )

      if (signIn.error) {
        throw new Error(
          `Failed to sign in ${prefix}`
        )
      }

      return {
        id:
          result.data.user.id,

        client,
      }
    }

    function createPrivilegedClient() {
      return createClient<Database>(
        url,
        serviceRoleKey,
        {
          ...options,

          global: {
            fetch: async (
              input,
              init
            ) => {
              const table =
                tableFromRequest(
                  input
                )

              if (
                failAudit &&
                table ===
                  'audit_events' &&
                (
                  init?.method ??
                  'GET'
                ) === 'POST'
              ) {
                return Response.json(
                  {
                    message:
                      'synthetic audit failure',
                  },
                  {
                    status: 500,
                  }
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
    }

    async function restoreMemberships() {
      const rows:
        Array<{
          organization_id:
            string
          user_id: string
          role: Role
        }> = [
        {
          organization_id:
            orgA,
          user_id:
            ownerId,
          role:
            'OWNER',
        },
        {
          organization_id:
            orgA,
          user_id:
            adminId,
          role:
            'ADMIN',
        },
        {
          organization_id:
            orgA,
          user_id:
            operatorId,
          role:
            'OPERATOR',
        },
        {
          organization_id:
            orgA,
          user_id:
            viewerId,
          role:
            'VIEWER',
        },
        {
          organization_id:
            orgB,
          user_id:
            ownerBId,
          role:
            'OWNER',
        },
      ]

      for (
        const row of rows
      ) {
        await checked(
          admin
            .from(
              'organization_users'
            )
            .upsert(
              row,
              {
                onConflict:
                  'organization_id,user_id',
              }
            )
        )
      }
    }

    beforeAll(
      async () => {
        const orgAResult =
          await checked(
            admin
              .from(
                'organizations'
              )
              .insert({
                name:
                  'MR7C2 Synthetic Org A',

                slug:
                  `mr7c2-a-${randomUUID()}`,
              })
              .select('id')
              .single()
          )

        const orgBResult =
          await checked(
            admin
              .from(
                'organizations'
              )
              .insert({
                name:
                  'MR7C2 Synthetic Org B',

                slug:
                  `mr7c2-b-${randomUUID()}`,
              })
              .select('id')
              .single()
          )

        if (
          !orgAResult ||
          !orgBResult
        ) {
          throw new Error(
            'Missing synthetic organizations'
          )
        }

        orgA =
          orgAResult.id

        orgB =
          orgBResult.id

        orgIds.push(
          orgA,
          orgB
        )

        const locAResult =
          await checked(
            admin
              .from(
                'locations'
              )
              .insert({
                organization_id:
                  orgA,

                name:
                  'Synthetic Privacy A',

                status:
                  'ACTIVE',
              })
              .select('id')
              .single()
          )

        const locBResult =
          await checked(
            admin
              .from(
                'locations'
              )
              .insert({
                organization_id:
                  orgB,

                name:
                  'Synthetic Privacy B',

                status:
                  'ACTIVE',
              })
              .select('id')
              .single()
          )

        if (
          !locAResult ||
          !locBResult
        ) {
          throw new Error(
            'Missing synthetic locations'
          )
        }

        locA =
          locAResult.id

        locB =
          locBResult.id

        const owner =
          await createUser(
            'owner'
          )

        ownerId =
          owner.id

        ownerClient =
          owner.client

        const adminUser =
          await createUser(
            'admin'
          )

        adminId =
          adminUser.id

        adminUserClient =
          adminUser.client

        const operator =
          await createUser(
            'operator'
          )

        operatorId =
          operator.id

        operatorClient =
          operator.client

        const viewer =
          await createUser(
            'viewer'
          )

        viewerId =
          viewer.id

        viewerClient =
          viewer.client

        const ownerB =
          await createUser(
            'owner-b'
          )

        ownerBId =
          ownerB.id

        ownerBClient =
          ownerB.client

        await restoreMemberships()

        const customerAResult =
          await checked(
            admin
              .from(
                'customers'
              )
              .insert({
                organization_id:
                  orgA,

                location_id:
                  locA,

                first_name:
                  'Privacy',

                last_name:
                  'Subject',

                email:
                  'privacy.subject@example.test',

                phone:
                  '+1 555 010 7777',

                permission_email:
                  'allowed',

                permission_sms:
                  'denied',

                permission_source:
                  'synthetic_test',
              })
              .select('id')
              .single()
          )

        const customerBResult =
          await checked(
            admin
              .from(
                'customers'
              )
              .insert({
                organization_id:
                  orgB,

                location_id:
                  locB,

                first_name:
                  'Foreign',

                last_name:
                  'Subject',

                email:
                  'foreign.subject@example.test',

                permission_email:
                  'allowed',

                permission_sms:
                  'unknown',

                permission_source:
                  'synthetic_test',
              })
              .select('id')
              .single()
          )

        if (
          !customerAResult ||
          !customerBResult
        ) {
          throw new Error(
            'Missing synthetic customers'
          )
        }

        customerA =
          customerAResult.id

        customerB =
          customerBResult.id

        const completionResult =
          await checked(
            admin
              .from(
                'customer_completion_events'
              )
              .insert({
                organization_id:
                  orgA,

                location_id:
                  locA,

                customer_id:
                  customerA,

                source:
                  'quick_complete',

                source_event_id:
                  `privacy-source-${randomUUID()}`,

                source_customer_id:
                  'SUBJECT-UPSTREAM-001',

                source_transaction_id:
                  'SUBJECT-TXN-001',

                country:
                  'CA',

                contact: {
                  email:
                    'privacy.subject@example.test',

                  phone:
                    '+1 555 010 7777',

                  firstName:
                    'Privacy',

                  lastName:
                    'Subject',

                  internalShouldNotLeak:
                    'PRIVATE_CONTACT_METADATA',
                },

                permission: {
                  email:
                    'allowed',

                  sms:
                    'denied',

                  source:
                    'synthetic_test',

                  internalShouldNotLeak:
                    'PRIVATE_PERMISSION_METADATA',
                },
              })
              .select('id')
              .single()
          )

        if (
          !completionResult
        ) {
          throw new Error(
            'Missing completion'
          )
        }

        completionA =
          completionResult.id

        const reviewResult =
          await checked(
            admin
              .from(
                'review_requests'
              )
              .insert({
                organization_id:
                  orgA,

                location_id:
                  locA,

                customer_id:
                  customerA,

                completion_event_id:
                  completionA,

                channel:
                  'email',

                status:
                  'DELIVERED',

                token:
                  'SECRET_REVIEW_TOKEN',

                token_hash:
                  'SECRET_REVIEW_TOKEN_HASH',

                unsubscribe_token:
                  'SECRET_UNSUBSCRIBE_TOKEN',

                unsubscribe_token_hash:
                  'SECRET_UNSUBSCRIBE_HASH',

                error_message:
                  'PRIVATE_PROVIDER_DETAIL',
              })
              .select('id')
              .single()
          )

        if (
          !reviewResult
        ) {
          throw new Error(
            'Missing review request'
          )
        }

        reviewA =
          reviewResult.id

        await checked(
          admin
            .from(
              'review_request_events'
            )
            .insert({
              organization_id:
                orgA,

              review_request_id:
                reviewA,

              event_type:
                'synthetic_delivered',

              metadata: {
                secret:
                  'PRIVATE_RRE_METADATA',
              },
            })
        )

        await checked(
          admin
            .from(
              'message_events'
            )
            .insert({
              organization_id:
                orgA,

              review_request_id:
                reviewA,

              provider:
                'resend',

              provider_message_id:
                'SECRET_PROVIDER_MESSAGE_ID',

              provider_event_id:
                `SECRET_PROVIDER_EVENT_${randomUUID()}`,

              event_type:
                'delivered',

              status:
                'DELIVERED',

              sanitized_error:
                'synthetic-safe-error',

              metadata: {
                secret:
                  'PRIVATE_ME_METADATA',
              },
            })
        )

        await checked(
          admin
            .from(
              'suppressions'
            )
            .insert({
              organization_id:
                orgA,

              channel:
                'email',

              contact_hash:
                hashSuppressionContact(
                  'email',
                  'privacy.subject@example.test'
                ),

              reason:
                'UNSUBSCRIBE',
            })
        )
      },
      30000
    )

    beforeEach(
      async () => {
        failedReadTable =
          null

        failAudit =
          false

        removeMembershipAfterTable =
          null

        membershipRemoved =
          false

        await restoreMemberships()

        await checked(
          admin
            .from(
              'audit_events'
            )
            .delete()
            .in(
              'organization_id',
              [
                orgA,
                orgB,
              ]
            )
            .eq(
              'event_type',
              'privacy.customer_export'
            )
        )

        privilegedClient =
          createPrivilegedClient()

        activeClient =
          ownerClient
      }
    )

    afterAll(
      async () => {
        if (
          orgIds.length >
          0
        ) {
          await admin
            .from(
              'organizations'
            )
            .delete()
            .in(
              'id',
              orgIds
            )
        }

        for (
          const userId of
            userIds
        ) {
          await admin.auth.admin
            .deleteUser(
              userId
            )
        }
      }
    )

    it(
      'exports only allowlisted customer data for OWNER and audits without raw PII',
      async () => {
        const result =
          await getCustomerPrivacyExport(
            orgA,
            customerA
          )

        expect(
          result.status
        ).toBe(
          'AVAILABLE'
        )

        if (
          result.status !==
          'AVAILABLE'
        ) {
          throw new Error(
            'Expected privacy export'
          )
        }

        expect(
          result.export
            .schemaVersion
        ).toBe(
          CUSTOMER_PRIVACY_EXPORT_SCHEMA_VERSION
        )

        expect(
          result.export.customer
        ).toMatchObject({
          id:
            customerA,

          firstName:
            'Privacy',

          lastName:
            'Subject',

          email:
            'privacy.subject@example.test',

          phone:
            '+1 555 010 7777',

          permissionEmail:
            'allowed',

          permissionSms:
            'denied',
        })

        expect(
          result.export
            .completionEvents
        ).toHaveLength(1)

        expect(
          result.export
            .completionEvents[0]
            .contactSnapshot
        ).toEqual({
          email:
            'privacy.subject@example.test',

          phone:
            '+1 555 010 7777',

          firstName:
            'Privacy',

          lastName:
            'Subject',
        })

        expect(
          result.export
            .completionEvents[0]
            .permissionSnapshot
        ).toEqual({
          email:
            'allowed',

          sms:
            'denied',

          source:
            'synthetic_test',
        })

        expect(
          result.export
            .reviewRequests
        ).toHaveLength(1)

        expect(
          result.export
            .reviewRequests[0]
            .events
        ).toEqual([
          expect.objectContaining({
            eventType:
              'synthetic_delivered',
          }),
        ])

        expect(
          result.export
            .reviewRequests[0]
            .messageEvents
        ).toEqual([
          expect.objectContaining({
            provider:
              'resend',

            eventType:
              'delivered',

            status:
              'DELIVERED',

            sanitizedError:
              'synthetic-safe-error',
          }),
        ])

        expect(
          result.export
            .authorityEvidence
            .length
        ).toBeGreaterThanOrEqual(
          2
        )

        expect(
          result.export
            .suppressions
        ).toEqual([
          expect.objectContaining({
            channel:
              'email',

            reason:
              'UNSUBSCRIBE',
          }),
        ])

        const serialized =
          JSON.stringify(
            result.export
          )

        for (
          const secret of [
            'SECRET_REVIEW_TOKEN',
            'SECRET_REVIEW_TOKEN_HASH',
            'SECRET_UNSUBSCRIBE_TOKEN',
            'SECRET_UNSUBSCRIBE_HASH',
            'SECRET_PROVIDER_MESSAGE_ID',
            'SECRET_PROVIDER_EVENT_',
            'PRIVATE_PROVIDER_DETAIL',
            'PRIVATE_RRE_METADATA',
            'PRIVATE_ME_METADATA',
            'PRIVATE_CONTACT_METADATA',
            'PRIVATE_PERMISSION_METADATA',

            hashSuppressionContact(
              'email',
              'privacy.subject@example.test'
            ),
          ]
        ) {
          expect(
            serialized
          ).not.toContain(
            secret
          )
        }

        const auditRows =
          await checked(
            admin
              .from(
                'audit_events'
              )
              .select('actor_type, actor_id, event_type, entity_type, entity_id, metadata')
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'privacy.customer_export'
              )
          )

        expect(
          auditRows
        ).toEqual([
          {
            actor_type:
              'user',

            actor_id:
              ownerId,

            event_type:
              'privacy.customer_export',

            entity_type:
              'customer',

            entity_id:
              customerA,

            metadata: {
              schema_version:
                '1.0',

              completion_count:
                1,

              review_request_count:
                1,

              authority_evidence_count:
                result.export
                  .authorityEvidence
                  .length,

              suppression_count:
                1,
            },
          },
        ])

        const serializedAudit =
          JSON.stringify(
            auditRows
          )

        expect(
          serializedAudit
        ).not.toContain(
          'privacy.subject@example.test'
        )

        expect(
          serializedAudit
        ).not.toContain(
          '+1 555 010 7777'
        )

        expect(
          serializedAudit
        ).not.toContain(
          '"Privacy"'
        )

        expect(
          serializedAudit
        ).not.toContain(
          '"Subject"'
        )
      }
    )

    it(
      'allows ADMIN but denies OPERATOR and VIEWER',
      async () => {
        activeClient =
          adminUserClient

        expect(
          (
            await getCustomerPrivacyExport(
              orgA,
              customerA
            )
          ).status
        ).toBe(
          'AVAILABLE'
        )

        await checked(
          admin
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
              'privacy.customer_export'
            )
        )

        activeClient =
          operatorClient

        expect(
          (
            await getCustomerPrivacyExport(
              orgA,
              customerA
            )
          ).status
        ).toBe(
          'DENIED'
        )

        activeClient =
          viewerClient

        expect(
          (
            await getCustomerPrivacyExport(
              orgA,
              customerA
            )
          ).status
        ).toBe(
          'DENIED'
        )

        const auditRows =
          await checked(
            admin
              .from(
                'audit_events'
              )
              .select(
                'id'
              )
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'privacy.customer_export'
              )
          )

        expect(
          auditRows
        ).toEqual([])
      }
    )

    it(
      'denies cross-tenant and nonexistent customer targets',
      async () => {
        activeClient =
          ownerClient

        expect(
          await getCustomerPrivacyExport(
            orgB,
            customerB
          )
        ).toEqual({
          status:
            'DENIED',
        })

        expect(
          await getCustomerPrivacyExport(
            orgA,
            customerB
          )
        ).toEqual({
          status:
            'DENIED',
        })

        expect(
          await getCustomerPrivacyExport(
            orgA,
            randomUUID()
          )
        ).toEqual({
          status:
            'DENIED',
        })

        activeClient =
          ownerBClient

        expect(
          (
            await getCustomerPrivacyExport(
              orgB,
              customerB
            )
          ).status
        ).toBe(
          'AVAILABLE'
        )
      }
    )

    it(
      'withholds partial output when a required tenant read fails',
      async () => {
        failedReadTable =
          'review_requests'

        activeClient =
          ownerClient

        expect(
          await getCustomerPrivacyExport(
            orgA,
            customerA
          )
        ).toEqual({
          status:
            'UNAVAILABLE',
        })

        const auditRows =
          await checked(
            admin
              .from(
                'audit_events'
              )
              .select(
                'id'
              )
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'privacy.customer_export'
              )
          )

        expect(
          auditRows
        ).toEqual([])
      }
    )

    it(
      'withholds export when mandatory audit persistence fails',
      async () => {
        failAudit =
          true

        privilegedClient =
          createPrivilegedClient()

        activeClient =
          ownerClient

        expect(
          await getCustomerPrivacyExport(
            orgA,
            customerA
          )
        ).toEqual({
          status:
            'UNAVAILABLE',
        })

        const auditRows =
          await checked(
            admin
              .from(
                'audit_events'
              )
              .select(
                'id'
              )
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'privacy.customer_export'
              )
          )

        expect(
          auditRows
        ).toEqual([])
      }
    )

    it(
      'rechecks authority before release when membership changes during export',
      async () => {
        removeMembershipAfterTable =
          'message_events'

        activeClient =
          ownerClient

        expect(
          await getCustomerPrivacyExport(
            orgA,
            customerA
          )
        ).toEqual({
          status:
            'DENIED',
        })

        expect(
          membershipRemoved
        ).toBe(true)

        const auditRows =
          await checked(
            admin
              .from(
                'audit_events'
              )
              .select(
                'id'
              )
              .eq(
                'organization_id',
                orgA
              )
              .eq(
                'event_type',
                'privacy.customer_export'
              )
          )

        expect(
          auditRows
        ).toEqual([])
      }
    )

    it(
      'does not mutate customer completion or review state apart from audit',
      async () => {
        activeClient =
          ownerClient

        const beforeCustomer =
          await checked(
            admin
              .from(
                'customers'
              )
              .select('*')
              .eq(
                'id',
                customerA
              )
              .single()
          )

        const beforeCompletion =
          await checked(
            admin
              .from(
                'customer_completion_events'
              )
              .select('*')
              .eq(
                'id',
                completionA
              )
              .single()
          )

        const beforeReview =
          await checked(
            admin
              .from(
                'review_requests'
              )
              .select('*')
              .eq(
                'id',
                reviewA
              )
              .single()
          )

        expect(
          (
            await getCustomerPrivacyExport(
              orgA,
              customerA
            )
          ).status
        ).toBe(
          'AVAILABLE'
        )

        expect(
          await checked(
            admin
              .from(
                'customers'
              )
              .select('*')
              .eq(
                'id',
                customerA
              )
              .single()
          )
        ).toEqual(
          beforeCustomer
        )

        expect(
          await checked(
            admin
              .from(
                'customer_completion_events'
              )
              .select('*')
              .eq(
                'id',
                completionA
              )
              .single()
          )
        ).toEqual(
          beforeCompletion
        )

        expect(
          await checked(
            admin
              .from(
                'review_requests'
              )
              .select('*')
              .eq(
                'id',
                reviewA
              )
              .single()
          )
        ).toEqual(
          beforeReview
        )
      }
    )
  }
)
