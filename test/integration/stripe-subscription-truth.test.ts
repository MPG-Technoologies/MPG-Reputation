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
  resolveStripeSubscriptionOrganization,
  type StripeSubscriptionProviderTruth,
} from '../../src/lib/billing/stripe-subscription-truth'
import { createAdminClient } from '../../src/lib/supabase/admin'

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY

const isDbAvailable =
  !!SERVICE_ROLE_KEY &&
  SERVICE_ROLE_KEY !== 'dummy_service_role_key'

const originalLiveBilling =
  process.env.ENABLE_LIVE_BILLING

describe.skipIf(!isDbAvailable)(
  'MR-5C Stripe provider truth and trusted organization correlation',
  () => {
    const supabase = createAdminClient()

    const nonce = Date.now()
    const sharedCustomerId =
      `cus_mr5c_truth_${nonce}`

    let testOrganizationId: string
    let liveOrganizationId: string
    let testBillingAccountId: string
    let liveBillingAccountId: string

    function makeEvent(args?: {
      type?: string
      livemode?: boolean
      objectId?: string
      eventCustomerId?: string
    }) {
      return {
        type:
          args?.type ??
          'customer.subscription.updated',
        livemode: args?.livemode ?? false,
        data: {
          object: {
            id:
              args?.objectId ??
              `sub_truth_${nonce}`,
            object: 'subscription',
            customer:
              args?.eventCustomerId ??
              'cus_stale_snapshot',
          },
        },
      }
    }

    function makeSubscription(args?: {
      id?: string
      customer?: string | { id: string }
      livemode?: boolean
      status?: string
    }): StripeSubscriptionProviderTruth {
      return {
        id:
          args?.id ??
          `sub_truth_${nonce}`,
        customer:
          args?.customer ??
          sharedCustomerId,
        livemode:
          args?.livemode ??
          false,
        status:
          args?.status ??
          'active',
      }
    }

    beforeAll(async () => {
      const {
        data: testOrg,
        error: testOrgError,
      } = await supabase
        .from('organizations')
        .insert({
          name: `MR5C Truth TEST ${nonce}`,
          slug: `mr5c-truth-test-${nonce}`,
        })
        .select('id')
        .single()

      if (testOrgError || !testOrg) {
        throw new Error(
          `TEST organization setup failed: ${testOrgError?.message}`
        )
      }

      testOrganizationId = testOrg.id

      const {
        data: liveOrg,
        error: liveOrgError,
      } = await supabase
        .from('organizations')
        .insert({
          name: `MR5C Truth LIVE ${nonce}`,
          slug: `mr5c-truth-live-${nonce}`,
        })
        .select('id')
        .single()

      if (liveOrgError || !liveOrg) {
        throw new Error(
          `LIVE organization setup failed: ${liveOrgError?.message}`
        )
      }

      liveOrganizationId = liveOrg.id

      const {
        data: testAccount,
        error: testAccountError,
      } = await supabase
        .from('organization_billing_accounts')
        .insert({
          organization_id: testOrganizationId,
          provider: 'stripe',
          environment: 'TEST',
          provider_customer_id:
            sharedCustomerId,
        })
        .select('id')
        .single()

      if (testAccountError || !testAccount) {
        throw new Error(
          `TEST billing account setup failed: ${testAccountError?.message}`
        )
      }

      testBillingAccountId =
        testAccount.id

      const {
        data: liveAccount,
        error: liveAccountError,
      } = await supabase
        .from('organization_billing_accounts')
        .insert({
          organization_id: liveOrganizationId,
          provider: 'stripe',
          environment: 'LIVE',
          provider_customer_id:
            sharedCustomerId,
        })
        .select('id')
        .single()

      if (liveAccountError || !liveAccount) {
        throw new Error(
          `LIVE billing account setup failed: ${liveAccountError?.message}`
        )
      }

      liveBillingAccountId =
        liveAccount.id
    })

    beforeEach(() => {
      delete process.env.ENABLE_LIVE_BILLING
    })

    afterAll(async () => {
      const organizationIds = [
        testOrganizationId,
        liveOrganizationId,
      ].filter(Boolean)

      if (organizationIds.length > 0) {
        await supabase
          .from('organizations')
          .delete()
          .in('id', organizationIds)
      }

      if (originalLiveBilling === undefined) {
        delete process.env.ENABLE_LIVE_BILLING
      } else {
        process.env.ENABLE_LIVE_BILLING =
          originalLiveBilling
      }
    })

    it('ignores unsupported event types without retrieving provider state', async () => {
      const retrieveSubscription = vi.fn()

      const result =
        await resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent({
            type: 'invoice.paid',
          }),
          retrieveSubscription,
        })

      expect(result).toEqual({
        outcome: 'UNSUPPORTED_EVENT',
        eventType: 'invoice.paid',
      })

      expect(
        retrieveSubscription
      ).not.toHaveBeenCalled()
    })

    it('resolves organization through persisted Stripe Customer mapping', async () => {
      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription()
        )

      const result =
        await resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent(),
          retrieveSubscription,
        })

      expect(result).toEqual({
        outcome: 'RESOLVED',
        environment: 'TEST',
        providerSubscriptionId:
          `sub_truth_${nonce}`,
        providerCustomerId:
          sharedCustomerId,
        providerStatus: 'active',
        billingAccountId:
          testBillingAccountId,
        organizationId:
          testOrganizationId,
      })
    })

    it('uses current provider truth instead of stale customer data in the event snapshot', async () => {
      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription({
            customer:
              sharedCustomerId,
          })
        )

      const result =
        await resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent({
            eventCustomerId:
              'cus_wrong_event_snapshot',
          }),
          retrieveSubscription,
        })

      expect(result.outcome).toBe('RESOLVED')

      if (result.outcome === 'RESOLVED') {
        expect(
          result.providerCustomerId
        ).toBe(sharedCustomerId)

        expect(
          result.organizationId
        ).toBe(testOrganizationId)
      }
    })

    it('returns UNRESOLVED_CUSTOMER instead of guessing an organization', async () => {
      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription({
            customer:
              `cus_unknown_${nonce}`,
          })
        )

      const result =
        await resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent(),
          retrieveSubscription,
        })

      expect(result).toMatchObject({
        outcome: 'UNRESOLVED_CUSTOMER',
        environment: 'TEST',
        providerCustomerId:
          `cus_unknown_${nonce}`,
      })
    })

    it('accepts an expanded Stripe Customer object and correlates by provider ID', async () => {
      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription({
            customer: {
              id: sharedCustomerId,
            },
          })
        )

      const result =
        await resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent(),
          retrieveSubscription,
        })

      expect(result.outcome).toBe('RESOLVED')

      if (result.outcome === 'RESOLVED') {
        expect(
          result.billingAccountId
        ).toBe(testBillingAccountId)
      }
    })

    it('fails closed when retrieved provider truth belongs to a different Stripe environment', async () => {
      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription({
            livemode: true,
          })
        )

      await expect(
        resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent({
            livemode: false,
          }),
          retrieveSubscription,
        })
      ).rejects.toThrow(
        'BILLING_STRIPE_SUBSCRIPTION_ENVIRONMENT_MISMATCH'
      )
    })

    it('rejects LIVE events before provider retrieval while live billing remains disabled', async () => {
      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription({
            livemode: true,
          })
        )

      await expect(
        resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent({
            livemode: true,
          }),
          retrieveSubscription,
        })
      ).rejects.toThrow(
        'Live Stripe billing is disabled.'
      )

      expect(
        retrieveSubscription
      ).not.toHaveBeenCalled()
    })

    it('keeps identical Stripe Customer IDs isolated between TEST and LIVE', async () => {
      process.env.ENABLE_LIVE_BILLING =
        'true'

      const retrieveSubscription =
        vi.fn(async () =>
          makeSubscription({
            livemode: true,
          })
        )

      const result =
        await resolveStripeSubscriptionOrganization({
          supabase,
          event: makeEvent({
            livemode: true,
          }),
          retrieveSubscription,
        })

      expect(result).toEqual({
        outcome: 'RESOLVED',
        environment: 'LIVE',
        providerSubscriptionId:
          `sub_truth_${nonce}`,
        providerCustomerId:
          sharedCustomerId,
        providerStatus: 'active',
        billingAccountId:
          liveBillingAccountId,
        organizationId:
          liveOrganizationId,
      })
    })
  }
)