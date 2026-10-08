import 'server-only'

import { handleCustomerPrivacyExportDelivery } from '@/domain/privacy/export-delivery'

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
  return handleCustomerPrivacyExportDelivery(organizationId, customerId)
}
