import {
  normalizeUniversalCompletionInput,
  type UniversalCompletionInput,
} from './index'

import {
  hashCompletionRequestBody,
  isFreshCompletionTimestamp,
  isValidCompletionNonce,
  parseCompletionApiKey,
  verifyCompletionApiSecret,
  verifyCompletionRequestSignature,
} from './api-auth'

import {
  deriveActivationReadiness,
  type ActivationDestination,
  type ActivationLocation,
} from '../activation/readiness'

const MAX_BODY_BYTES = 64 * 1024

export interface CompletionApiCredential {
  id: string
  organizationId: string
  secretHash: string
  status: 'ACTIVE' | 'REVOKED'
}

export interface CompletionIngestionClaim {
  accepted: boolean
  replay: boolean
  rate_limited: boolean
  stale: boolean
  ingestion_id: string | null
}

export interface SystemCompletionSubmission {
  organizationId: string
  locationId: string
  firstName: string
  lastName: string | null
  email: string
  phone: string | null
  permissionEmail: 'allowed' | 'unknown' | 'denied'
  permissionSms: 'allowed' | 'unknown' | 'denied'
  permissionSource: string
  source: string
  sourceEventId: string
  sourceCustomerId: string | null
  sourceTransactionId: string | null
  completedAt: string
  country: string
}

export interface SystemCompletionResult {
  duplicate: boolean
  customerId: string
  completionEventId: string
  outboxId: string | null
  sourceEventId: string
}

export interface CompletionIngestionFinalize {
  ingestionId: string
  organizationId: string
  status:
    | 'ACCEPTED'
    | 'DUPLICATE'
    | 'REJECTED'
    | 'FAILED'
  httpStatus: number
  errorCode?: string | null
  sourceEventId?: string | null
  locationId?: string | null
  completionEventId?: string | null
}

export interface CompletionApiStore {
  getCredential(
    credentialId: string
  ): Promise<CompletionApiCredential | null>

  claimIngestion(input: {
    organizationId: string
    credentialId: string
    nonce: string
    requestTimestamp: string
    requestBodyHash: string
  }): Promise<CompletionIngestionClaim>

  getActivationContext(
    organizationId: string,
    locationId: string
  ): Promise<{
    location: ActivationLocation | null
    destination: ActivationDestination | null
  }>

  submitCompletion(
    input: SystemCompletionSubmission
  ): Promise<SystemCompletionResult>

  finalizeIngestion(
    input: CompletionIngestionFinalize
  ): Promise<void>
}

function json(
  body: Record<string, unknown>,
  status: number
): Response {
  return Response.json(body, { status })
}

async function safeFinalize(
  store: CompletionApiStore,
  input: CompletionIngestionFinalize
): Promise<void> {
  try {
    await store.finalizeIngestion(input)
  } catch (error) {
    console.error(
      '[CompletionAPI] Failed to finalize ingestion audit:',
      error
    )
  }
}

export async function handleCompletionApiRequest(
  req: Request,
  store: CompletionApiStore
): Promise<Response> {
  const contentLength = Number(
    req.headers.get('content-length') || '0'
  )

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    return json(
      {
        error: 'PAYLOAD_TOO_LARGE',
      },
      413
    )
  }

  const rawBody = await req.text()

  if (
    Buffer.byteLength(rawBody, 'utf8') >
    MAX_BODY_BYTES
  ) {
    return json(
      {
        error: 'PAYLOAD_TOO_LARGE',
      },
      413
    )
  }

  const parsedKey = parseCompletionApiKey(
    req.headers.get('authorization')
  )

  if (!parsedKey) {
    return json(
      {
        error: 'UNAUTHORIZED',
      },
      401
    )
  }

  const timestamp =
    req.headers.get('x-mpg-timestamp')

  const nonce =
    req.headers.get('x-mpg-nonce')

  const signature =
    req.headers.get('x-mpg-signature')

  if (
    !timestamp ||
    !/^\d{10}$/.test(timestamp) ||
    !isValidCompletionNonce(nonce)
  ) {
    return json(
      {
        error: 'INVALID_SECURITY_HEADERS',
      },
      400
    )
  }

  if (
    !isFreshCompletionTimestamp(timestamp)
  ) {
    return json(
      {
        error: 'STALE_REQUEST',
      },
      400
    )
  }

  let credential: CompletionApiCredential | null

  try {
    credential = await store.getCredential(
      parsedKey.credentialId
    )
  } catch (error) {
    console.error(
      '[CompletionAPI] Credential lookup failed:',
      error
    )

    return json(
      {
        error: 'SERVER_ERROR',
      },
      500
    )
  }

  if (
    !credential ||
    credential.status !== 'ACTIVE' ||
    !verifyCompletionApiSecret(
      parsedKey.secret,
      credential.secretHash
    )
  ) {
    return json(
      {
        error: 'UNAUTHORIZED',
      },
      401
    )
  }

  if (
    !verifyCompletionRequestSignature(
      parsedKey.secret,
      timestamp,
      nonce,
      rawBody,
      signature
    )
  ) {
    return json(
      {
        error: 'UNAUTHORIZED',
      },
      401
    )
  }

  const requestBodyHash =
    hashCompletionRequestBody(rawBody)

  let claim: CompletionIngestionClaim

  try {
    claim = await store.claimIngestion({
      organizationId:
        credential.organizationId,
      credentialId: credential.id,
      nonce,
      requestTimestamp:
        new Date(
          Number(timestamp) * 1000
        ).toISOString(),
      requestBodyHash,
    })
  } catch (error) {
    console.error(
      '[CompletionAPI] Ingestion claim failed:',
      error
    )

    return json(
      {
        error: 'SERVER_ERROR',
      },
      500
    )
  }

  if (claim.stale) {
    return json(
      {
        error: 'STALE_REQUEST',
      },
      400
    )
  }

  if (claim.replay) {
    return json(
      {
        error: 'REPLAY_DETECTED',
      },
      409
    )
  }

  if (claim.rate_limited) {
    return json(
      {
        error: 'RATE_LIMITED',
      },
      429
    )
  }

  if (
    !claim.accepted ||
    !claim.ingestion_id
  ) {
    return json(
      {
        error: 'INGESTION_REJECTED',
      },
      400
    )
  }

  const ingestionId =
    claim.ingestion_id

  let payload: UniversalCompletionInput

  try {
    payload = JSON.parse(
      rawBody
    ) as UniversalCompletionInput
  } catch {
    await safeFinalize(store, {
      ingestionId,
      organizationId:
        credential.organizationId,
      status: 'REJECTED',
      httpStatus: 400,
      errorCode: 'INVALID_JSON',
    })

    return json(
      {
        error: 'INVALID_JSON',
      },
      400
    )
  }

  const normalized =
    normalizeUniversalCompletionInput(
      credential.organizationId,
      payload
    )

  if (
    !normalized.valid ||
    !normalized.canonical ||
    !normalized.customerPayload
  ) {
    await safeFinalize(store, {
      ingestionId,
      organizationId:
        credential.organizationId,
      status: 'REJECTED',
      httpStatus: 422,
      errorCode:
        'INVALID_COMPLETION_PAYLOAD',
    })

    return Response.json(
      {
        error:
          'INVALID_COMPLETION_PAYLOAD',
        fieldErrors:
          normalized.errors || {},
      },
      {
        status: 422,
      }
    )
  }

  const {
    canonical,
    customerPayload,
  } = normalized

  let activationContext: {
    location: ActivationLocation | null
    destination:
      | ActivationDestination
      | null
  }

  try {
    activationContext =
      await store.getActivationContext(
        credential.organizationId,
        canonical.location_id
      )
  } catch (error) {
    console.error(
      '[CompletionAPI] Activation lookup failed:',
      error
    )

    await safeFinalize(store, {
      ingestionId,
      organizationId:
        credential.organizationId,
      status: 'FAILED',
      httpStatus: 500,
      errorCode:
        'ACTIVATION_LOOKUP_FAILED',
      sourceEventId:
        canonical.source_event_id,
      locationId:
        canonical.location_id,
    })

    return json(
      {
        error: 'SERVER_ERROR',
      },
      500
    )
  }

  const readiness =
    deriveActivationReadiness(
      activationContext.location
        ? [activationContext.location]
        : [],
      activationContext.destination
        ? [activationContext.destination]
        : []
    )

  if (!readiness.ready) {
    await safeFinalize(store, {
      ingestionId,
      organizationId:
        credential.organizationId,
      status: 'REJECTED',
      httpStatus: 409,
      errorCode:
        'LOCATION_NOT_READY',
      sourceEventId:
        canonical.source_event_id,
      locationId:
        canonical.location_id,
    })

    return json(
      {
        error: 'LOCATION_NOT_READY',
      },
      409
    )
  }

  let result: SystemCompletionResult

  try {
    result =
      await store.submitCompletion({
        organizationId:
          canonical.organization_id,
        locationId:
          canonical.location_id,
        firstName:
          customerPayload.first_name,
        lastName:
          customerPayload.last_name,
        email:
          customerPayload.email,
        phone:
          customerPayload.phone,
        permissionEmail:
          customerPayload.permission_email,
        permissionSms:
          customerPayload.permission_sms,
        permissionSource:
          customerPayload.permission_source,
        source:
          canonical.source,
        sourceEventId:
          canonical.source_event_id,
        sourceCustomerId:
          canonical.source_customer_id,
        sourceTransactionId:
          canonical.source_transaction_id,
        completedAt:
          canonical.completed_at,
        country:
          canonical.country,
      })
  } catch (error) {
    console.error(
      '[CompletionAPI] Atomic completion failed:',
      error
    )

    await safeFinalize(store, {
      ingestionId,
      organizationId:
        credential.organizationId,
      status: 'FAILED',
      httpStatus: 500,
      errorCode:
        'COMPLETION_PERSIST_FAILED',
      sourceEventId:
        canonical.source_event_id,
      locationId:
        canonical.location_id,
    })

    return json(
      {
        error: 'SERVER_ERROR',
      },
      500
    )
  }

  const httpStatus =
    result.duplicate ? 200 : 202

  await safeFinalize(store, {
    ingestionId,
    organizationId:
      credential.organizationId,
    status:
      result.duplicate
        ? 'DUPLICATE'
        : 'ACCEPTED',
    httpStatus,
    sourceEventId:
      canonical.source_event_id,
    locationId:
      canonical.location_id,
    completionEventId:
      result.completionEventId,
  })

  return json(
    {
      accepted: true,
      duplicate: result.duplicate,
      eventId:
        result.completionEventId,
      sourceEventId:
        result.sourceEventId,
    },
    httpStatus
  )
}
