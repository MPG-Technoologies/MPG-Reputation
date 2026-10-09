'use server'

import { revalidatePath } from 'next/cache'
import {
  handleCustomerErasurePreflight,
  handleCustomerErasureExecution,
  type CustomerErasurePreflightResponse,
  type CustomerErasureExecutionResponse,
} from '@/domain/privacy/erasure-delivery'

/**
 * Server Action for preflight eligibility check.
 */
export async function checkCustomerErasurePreflightAction(
  organizationId: string,
  customerId: string
): Promise<CustomerErasurePreflightResponse> {
  const response = await handleCustomerErasurePreflight(organizationId, customerId)
  return response.json()
}

/**
 * Server Action for executing customer erasure with confirmation.
 */
export async function executeCustomerErasureAction(
  organizationId: string,
  customerId: string,
  confirmation: string
): Promise<CustomerErasureExecutionResponse> {
  const response = await handleCustomerErasureExecution(
    organizationId,
    customerId,
    confirmation
  )
  const result: CustomerErasureExecutionResponse = await response.json()

  if (result.success) {
    try {
      revalidatePath('/app/customers')
    } catch {
      // Safe no-op outside Next.js request execution context
    }
  }

  return result
}
