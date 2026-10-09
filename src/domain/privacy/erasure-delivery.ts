import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import {
  eraseCustomer,
  checkErasureAuthority,
} from '@/domain/privacy/customer-erasure'
import { checkCustomerErasureEligibility } from '@/domain/privacy/erasure-guard'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CustomerErasurePreflightResponse {
  status: 'ELIGIBLE' | 'BLOCKED' | 'DENIED' | 'UNAVAILABLE'
  eligible: boolean
  message: string
}

export interface CustomerErasureExecutionResponse {
  status: 'SUCCESS' | 'DENIED' | 'BLOCKED' | 'CONFIRMATION_REQUIRED' | 'UNAVAILABLE'
  success: boolean
  customerId?: string
  erasedAt?: string
  alreadyErased?: boolean
  error?: string
}

/**
 * Handle preflight eligibility check for customer erasure.
 *
 * Security & Invariant Rules:
 * - Requires authenticated session.
 * - OWNER only in organization_users; ADMIN, OPERATOR, VIEWER, and anon are DENIED (403).
 * - Customer must belong to organizationId; foreign/nonexistent returns DENIED (403) to prevent existence leakage.
 * - Checks legacy recipient evidence gate:
 *   - If blocked by legacy requests -> returns safe non-PII blocked status (200).
 *   - If eligible -> returns safe ELIGIBLE status (200).
 * - Never returns raw SQL errors, stack traces, hashes, or sensitive identifiers.
 */
export async function handleCustomerErasurePreflight(
  organizationId: string,
  customerId: string,
  options?: {
    tenantClient?: SupabaseClient<Database>
    adminClient?: SupabaseClient<Database>
  }
): Promise<Response> {
  if (
    !organizationId ||
    !UUID_REGEX.test(organizationId) ||
    !customerId ||
    !UUID_REGEX.test(customerId)
  ) {
    return Response.json(
      {
        status: 'DENIED',
        eligible: false,
        message: 'Not authorized',
      } satisfies CustomerErasurePreflightResponse,
      {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }

  try {
    const tenantClient = options?.tenantClient ?? (await createClient())
    const {
      data: { user },
      error: authError,
    } = await tenantClient.auth.getUser()

    if (authError || !user || user.is_anonymous) {
      return Response.json(
        {
          status: 'DENIED',
          eligible: false,
          message: 'Not authorized',
        } satisfies CustomerErasurePreflightResponse,
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    const authority = await checkErasureAuthority(
      tenantClient,
      organizationId,
      user.id
    )

    if (authority !== 'AUTHORIZED') {
      return Response.json(
        {
          status: 'DENIED',
          eligible: false,
          message: 'Not authorized',
        } satisfies CustomerErasurePreflightResponse,
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    // Verify customer exists in tenant
    const { data: customer, error: custError } = await tenantClient
      .from('customers')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', customerId)
      .maybeSingle()

    if (custError) {
      return Response.json(
        {
          status: 'UNAVAILABLE',
          eligible: false,
          message: 'Temporarily unavailable',
        } satisfies CustomerErasurePreflightResponse,
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    if (!customer) {
      // Fail closed without leaking existence
      return Response.json(
        {
          status: 'DENIED',
          eligible: false,
          message: 'Not authorized',
        } satisfies CustomerErasurePreflightResponse,
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    const adminClient = options?.adminClient ?? createAdminClient()
    const eligibility = await checkCustomerErasureEligibility({
      supabase: adminClient,
      organizationId,
      customerId,
    })

    if (!eligibility.eligible) {
      if (eligibility.decision === 'CUSTOMER_NOT_FOUND') {
        return Response.json(
          {
            status: 'DENIED',
            eligible: false,
            message: 'Not authorized',
          } satisfies CustomerErasurePreflightResponse,
          {
            status: 403,
            headers: { 'Cache-Control': 'no-store' },
          }
        )
      }

      if (eligibility.decision === 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS') {
        return Response.json(
          {
            status: 'BLOCKED',
            eligible: false,
            message:
              'Erasure blocked because historical delivery evidence cannot be safely resolved.',
          } satisfies CustomerErasurePreflightResponse,
          {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
          }
        )
      }
    }

    return Response.json(
      {
        status: 'ELIGIBLE',
        eligible: true,
        message: 'Eligible for erasure.',
      } satisfies CustomerErasurePreflightResponse,
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch {
    return Response.json(
      {
        status: 'UNAVAILABLE',
        eligible: false,
        message: 'Temporarily unavailable',
      } satisfies CustomerErasurePreflightResponse,
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }
}

/**
 * Handle controlled customer erasure execution.
 *
 * Security & Invariant Rules:
 * - Requires explicit typed confirmation `ERASE`.
 * - Requires authenticated session.
 * - OWNER only in organization_users; ADMIN, OPERATOR, VIEWER, and anon are DENIED (403).
 * - Customer must belong to organizationId; foreign/nonexistent returns DENIED (403) to prevent existence leakage.
 * - Invokes domain eraseCustomer -> database execute_customer_erasure RPC inside single transaction.
 * - Final authority check performed inside PostgreSQL transaction.
 * - Zero PII, zero internal details, zero database error leakage in response.
 */
export async function handleCustomerErasureExecution(
  organizationId: string,
  customerId: string,
  confirmation?: string,
  options?: {
    tenantClient?: SupabaseClient<Database>
    adminClient?: SupabaseClient<Database>
  }
): Promise<Response> {
  if (
    !organizationId ||
    !UUID_REGEX.test(organizationId) ||
    !customerId ||
    !UUID_REGEX.test(customerId)
  ) {
    return Response.json(
      {
        status: 'DENIED',
        success: false,
        error: 'Not authorized',
      } satisfies CustomerErasureExecutionResponse,
      {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }

  // Require explicit confirmation
  if (confirmation !== 'ERASE') {
    return Response.json(
      {
        status: 'CONFIRMATION_REQUIRED',
        success: false,
        error: 'Confirmation required. Please type ERASE to confirm.',
      } satisfies CustomerErasureExecutionResponse,
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }

  try {
    const tenantClient = options?.tenantClient ?? (await createClient())
    const adminClient = options?.adminClient ?? createAdminClient()

    const eraseResult = await eraseCustomer({
      organizationId,
      customerId,
      tenantClient,
      adminClient,
    })

    if (eraseResult.status === 'DENIED') {
      return Response.json(
        {
          status: 'DENIED',
          success: false,
          error: 'Not authorized',
        } satisfies CustomerErasureExecutionResponse,
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    if (eraseResult.status === 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS') {
      return Response.json(
        {
          status: 'BLOCKED',
          success: false,
          error:
            'Erasure blocked because historical delivery evidence cannot be safely resolved.',
        } satisfies CustomerErasureExecutionResponse,
        {
          status: 409,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    if (eraseResult.status === 'UNAVAILABLE') {
      return Response.json(
        {
          status: 'UNAVAILABLE',
          success: false,
          error: 'Temporarily unavailable',
        } satisfies CustomerErasureExecutionResponse,
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      )
    }

    // Success: return safe non-PII operational response
    return Response.json(
      {
        status: 'SUCCESS',
        success: true,
        customerId: eraseResult.customerId,
        erasedAt: eraseResult.erasedAt,
        alreadyErased: eraseResult.alreadyErased,
      } satisfies CustomerErasureExecutionResponse,
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch {
    return Response.json(
      {
        status: 'UNAVAILABLE',
        success: false,
        error: 'Temporarily unavailable',
      } satisfies CustomerErasureExecutionResponse,
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }
}
