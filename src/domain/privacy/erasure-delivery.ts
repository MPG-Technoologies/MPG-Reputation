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
  status: 'ERASED' | 'DENIED' | 'BLOCKED' | 'CONFIRMATION_REQUIRED' | 'UNAVAILABLE'
  success: boolean
  erasedAt?: string
  alreadyErased?: boolean
  error?: string
}

/**
 * Handle preflight eligibility check for customer erasure.
 *
 * Security & Invariant Rules:
 * - Requires authenticated session.
 * - OWNER only in organization_users; ADMIN, OPERATOR, VIEWER, and anon are DENIED.
 * - Customer must belong to organizationId; foreign/nonexistent returns DENIED to prevent existence leakage.
 * - Checks legacy recipient evidence gate:
 *   - If blocked by legacy requests -> returns safe non-PII blocked status.
 *   - If eligible -> returns safe ELIGIBLE status.
 * - Never returns raw SQL errors, stack traces, hashes, or sensitive identifiers.
 */
export async function handleCustomerErasurePreflight(
  organizationId: string,
  customerId: string,
  options?: {
    tenantClient?: SupabaseClient<Database>
    adminClient?: SupabaseClient<Database>
  }
): Promise<CustomerErasurePreflightResponse> {
  if (
    !organizationId ||
    !UUID_REGEX.test(organizationId) ||
    !customerId ||
    !UUID_REGEX.test(customerId)
  ) {
    return {
      status: 'DENIED',
      eligible: false,
      message: 'Not authorized',
    }
  }

  try {
    const tenantClient = options?.tenantClient ?? (await createClient())
    const {
      data: { user },
      error: authError,
    } = await tenantClient.auth.getUser()

    if (authError || !user || user.is_anonymous) {
      return {
        status: 'DENIED',
        eligible: false,
        message: 'Not authorized',
      }
    }

    const authority = await checkErasureAuthority(
      tenantClient,
      organizationId,
      user.id
    )

    if (authority !== 'AUTHORIZED') {
      return {
        status: 'DENIED',
        eligible: false,
        message: 'Not authorized',
      }
    }

    // Verify customer exists in tenant
    const { data: customer, error: custError } = await tenantClient
      .from('customers')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', customerId)
      .maybeSingle()

    if (custError) {
      return {
        status: 'UNAVAILABLE',
        eligible: false,
        message: 'Temporarily unavailable',
      }
    }

    if (!customer) {
      // Fail closed without leaking existence
      return {
        status: 'DENIED',
        eligible: false,
        message: 'Not authorized',
      }
    }

    const adminClient = options?.adminClient ?? createAdminClient()
    const eligibility = await checkCustomerErasureEligibility({
      supabase: adminClient,
      organizationId,
      customerId,
    })

    if (!eligibility.eligible) {
      if (eligibility.decision === 'CUSTOMER_NOT_FOUND') {
        return {
          status: 'DENIED',
          eligible: false,
          message: 'Not authorized',
        }
      }

      if (eligibility.decision === 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS') {
        return {
          status: 'BLOCKED',
          eligible: false,
          message:
            'Erasure blocked because historical delivery evidence cannot be safely resolved.',
        }
      }
    }

    return {
      status: 'ELIGIBLE',
      eligible: true,
      message: 'Eligible for erasure.',
    }
  } catch {
    return {
      status: 'UNAVAILABLE',
      eligible: false,
      message: 'Temporarily unavailable',
    }
  }
}

/**
 * Handle controlled customer erasure execution.
 *
 * Security & Invariant Rules:
 * - Requires explicit typed confirmation `ERASE`.
 * - Requires authenticated session.
 * - OWNER only in organization_users; ADMIN, OPERATOR, VIEWER, and anon are DENIED.
 * - Customer must belong to organizationId; foreign/nonexistent returns DENIED to prevent existence leakage.
 * - Invokes domain eraseCustomer -> database execute_customer_erasure RPC inside single transaction.
 * - Final authority check performed inside PostgreSQL transaction.
 * - Zero PII, zero internal details, zero database error leakage, zero customerId in success response.
 */
export async function handleCustomerErasureExecution(
  organizationId: string,
  customerId: string,
  confirmation?: string,
  options?: {
    tenantClient?: SupabaseClient<Database>
    adminClient?: SupabaseClient<Database>
  }
): Promise<CustomerErasureExecutionResponse> {
  if (
    !organizationId ||
    !UUID_REGEX.test(organizationId) ||
    !customerId ||
    !UUID_REGEX.test(customerId)
  ) {
    return {
      status: 'DENIED',
      success: false,
      error: 'Not authorized',
    }
  }

  // Require explicit confirmation
  if (confirmation !== 'ERASE') {
    return {
      status: 'CONFIRMATION_REQUIRED',
      success: false,
      error: 'Confirmation required. Please type ERASE to confirm.',
    }
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
      return {
        status: 'DENIED',
        success: false,
        error: 'Not authorized',
      }
    }

    if (eraseResult.status === 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS') {
      return {
        status: 'BLOCKED',
        success: false,
        error:
          'Erasure blocked because historical delivery evidence cannot be safely resolved.',
      }
    }

    if (eraseResult.status === 'UNAVAILABLE') {
      return {
        status: 'UNAVAILABLE',
        success: false,
        error: 'Temporarily unavailable',
      }
    }

    // Success: return safe non-PII operational response without customerId
    return {
      status: 'ERASED',
      success: true,
      erasedAt: eraseResult.erasedAt,
      alreadyErased: eraseResult.alreadyErased,
    }
  } catch {
    return {
      status: 'UNAVAILABLE',
      success: false,
      error: 'Temporarily unavailable',
    }
  }
}
