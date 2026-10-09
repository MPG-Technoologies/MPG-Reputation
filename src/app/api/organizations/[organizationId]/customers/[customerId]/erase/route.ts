import 'server-only'

import {
  handleCustomerErasurePreflight,
  handleCustomerErasureExecution,
} from '@/domain/privacy/erasure-delivery'

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      organizationId: string
      customerId: string
    }>
  }
) {
  const { organizationId, customerId } = await context.params
  return handleCustomerErasurePreflight(organizationId, customerId)
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      organizationId: string
      customerId: string
    }>
  }
) {
  const { organizationId, customerId } = await context.params
  let confirmation: string | undefined

  try {
    const body = await request.json()
    confirmation = typeof body?.confirmation === 'string' ? body.confirmation : undefined
  } catch {
    confirmation = undefined
  }

  return handleCustomerErasureExecution(organizationId, customerId, confirmation)
}
