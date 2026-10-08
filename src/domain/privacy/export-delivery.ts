import 'server-only'

import { getCustomerPrivacyExport } from '@/domain/privacy/customer-export'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PrivacyExportErrorResponse {
  status: 'DENIED' | 'UNAVAILABLE'
  error: string
}

/**
 * HTTP delivery handler for customer privacy export.
 *
 * Security & Contract Invariants:
 * - The browser-supplied organizationId and customerId are target input only, not authority.
 * - Authorization is strictly and solely enforced by getCustomerPrivacyExport(organizationId, customerId)
 *   (authenticated session, tenant membership, OWNER and ADMIN only).
 * - Delivery handler does not duplicate or weaken C2A domain authorization checks.
 * - Nonexistent customers, foreign tenants, forged organizationIds, and unauthorized roles return
 *   an identical fail-closed 403 DENIED response (zero existence disclosure).
 * - Successful responses return application/json UTF-8 attachment with Cache-Control: no-store.
 * - Filename is safe: mpg-customer-privacy-export-<customerId>.json (zero customer PII in filename).
 * - DENIED and UNAVAILABLE responses return zero export payload or partial PII.
 * - No caching, persistence, or secondary logging of privacy payload occurs.
 */
export async function handleCustomerPrivacyExportDelivery(
  organizationId: string,
  customerId: string
): Promise<Response> {
  // Validate target input UUID syntax fail-closed
  if (
    !organizationId ||
    !UUID_REGEX.test(organizationId) ||
    !customerId ||
    !UUID_REGEX.test(customerId)
  ) {
    return Response.json(
      { status: 'DENIED', error: 'Not authorized' } satisfies PrivacyExportErrorResponse,
      {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    )
  }

  try {
    // Authoritative C2A domain export execution
    // getCustomerPrivacyExport independently verifies:
    // - authenticated user session
    // - active organization membership
    // - OWNER / ADMIN role authority (denies OPERATOR, VIEWER, non-members)
    // - customer tenant scope
    // - suppression & authority evidence
    // - mandatory privacy.customer_export audit
    const exportResult = await getCustomerPrivacyExport(
      organizationId,
      customerId
    )

    if (exportResult.status === 'DENIED') {
      return Response.json(
        { status: 'DENIED', error: 'Not authorized' } satisfies PrivacyExportErrorResponse,
        {
          status: 403,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      )
    }

    if (exportResult.status === 'UNAVAILABLE') {
      return Response.json(
        { status: 'UNAVAILABLE', error: 'Temporarily unavailable' } satisfies PrivacyExportErrorResponse,
        {
          status: 503,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      )
    }

    // AVAILABLE: return application/json UTF-8 attachment with safe filename and no-store
    const safeFilename = `mpg-customer-privacy-export-${customerId}.json`
    const payloadJson = JSON.stringify(exportResult.export, null, 2)

    return new Response(payloadJson, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    // Unexpected server errors fail closed as UNAVAILABLE without leaking internal details
    return Response.json(
      { status: 'UNAVAILABLE', error: 'Temporarily unavailable' } satisfies PrivacyExportErrorResponse,
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    )
  }
}
