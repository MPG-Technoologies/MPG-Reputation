import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto'

const API_KEY_PATTERN =
  /^mpg_v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{32,})$/i

const NONCE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/

const SIGNATURE_PATTERN =
  /^v1=([0-9a-f]{64})$/i

export interface ParsedCompletionApiKey {
  credentialId: string
  secret: string
}

export function parseCompletionApiKey(
  authorization: string | null
): ParsedCompletionApiKey | null {
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const rawKey = authorization.slice(7).trim()
  const match = rawKey.match(API_KEY_PATTERN)

  if (!match) {
    return null
  }

  return {
    credentialId: match[1].toLowerCase(),
    secret: match[2],
  }
}

export function hashCompletionApiSecret(
  secret: string
): string {
  return createHash('sha256')
    .update(secret, 'utf8')
    .digest('hex')
}

export function hashCompletionRequestBody(
  rawBody: string
): string {
  return createHash('sha256')
    .update(rawBody, 'utf8')
    .digest('hex')
}

export function verifyCompletionApiSecret(
  providedSecret: string,
  storedSecretHash: string
): boolean {
  if (
    !/^[0-9a-f]{64}$/i.test(storedSecretHash)
  ) {
    return false
  }

  const providedHash = Buffer.from(
    hashCompletionApiSecret(providedSecret),
    'hex'
  )

  const storedHash = Buffer.from(
    storedSecretHash,
    'hex'
  )

  return timingSafeEqual(
    providedHash,
    storedHash
  )
}

export function isValidCompletionNonce(
  nonce: string | null
): nonce is string {
  return Boolean(
    nonce && NONCE_PATTERN.test(nonce)
  )
}

export function isFreshCompletionTimestamp(
  timestamp: string | null,
  nowMs = Date.now(),
  toleranceSeconds = 300
): boolean {
  if (!timestamp || !/^\d{10}$/.test(timestamp)) {
    return false
  }

  const seconds = Number(timestamp)

  if (!Number.isSafeInteger(seconds)) {
    return false
  }

  return (
    Math.abs(nowMs - seconds * 1000) <=
    toleranceSeconds * 1000
  )
}

export function buildCompletionSignaturePayload(
  timestamp: string,
  nonce: string,
  rawBody: string
): string {
  return `${timestamp}.${nonce}.${rawBody}`
}

export function signCompletionRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: string
): string {
  const signature = createHmac(
    'sha256',
    secret
  )
    .update(
      buildCompletionSignaturePayload(
        timestamp,
        nonce,
        rawBody
      ),
      'utf8'
    )
    .digest('hex')

  return `v1=${signature}`
}

export function verifyCompletionRequestSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const match =
    signatureHeader?.match(
      SIGNATURE_PATTERN
    )

  if (!match) {
    return false
  }

  const expected = createHmac(
    'sha256',
    secret
  )
    .update(
      buildCompletionSignaturePayload(
        timestamp,
        nonce,
        rawBody
      ),
      'utf8'
    )
    .digest()

  const received = Buffer.from(
    match[1],
    'hex'
  )

  return (
    received.length === expected.length &&
    timingSafeEqual(
      received,
      expected
    )
  )
}
