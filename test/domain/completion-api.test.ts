import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  normalizeUniversalCompletionInput,
  universalCompletionAdapter,
} from '../../src/domain/completion'

import {
  hashCompletionApiSecret,
  hashCompletionRequestBody,
  isFreshCompletionTimestamp,
  isValidCompletionNonce,
  parseCompletionApiKey,
  signCompletionRequest,
  verifyCompletionApiSecret,
  verifyCompletionRequestSignature,
} from '../../src/domain/completion/api-auth'

const ORG_ID =
  '11111111-1111-4111-8111-111111111111'

const LOCATION_ID =
  '22222222-2222-4222-8222-222222222222'

const CREDENTIAL_ID =
  '33333333-3333-4333-8333-333333333333'

const SECRET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-'

describe(
  'MR-3A completion API normalization',
  () => {
    it(
      'normalizes an external completion into the canonical customer.completed model',
      () => {
        const result =
          normalizeUniversalCompletionInput(
            ORG_ID,
            {
              event_id:
                'job-123-completed',
              location_id: LOCATION_ID,
              completed_at:
                '2026-09-19T08:30:00.000Z',
              country: 'us',
              customer: {
                first_name: ' Alice ',
                last_name: ' Smith ',
                email:
                  'Alice.Smith@Example.TEST',
                phone: ' +15551234567 ',
                source_customer_id:
                  'customer-55',
              },
              transaction_id:
                'job-123',
              permission: {
                email: 'allowed',
                sms: 'unknown',
              },
            }
          )

        expect(result.valid).toBe(true)
        expect(
          result.canonical?.source
        ).toBe('api_v1')

        expect(
          result.canonical
            ?.source_event_id
        ).toBe(
          'job-123-completed'
        )

        expect(
          result.canonical
            ?.contact.email
        ).toBe(
          'alice.smith@example.test'
        )

        expect(
          result.canonical?.country
        ).toBe('US')

        expect(
          result.canonical
            ?.source_customer_id
        ).toBe('customer-55')

        expect(
          result.canonical
            ?.source_transaction_id
        ).toBe('job-123')

        expect(
          result.customerPayload
            ?.permission_source
        ).toBe('api_v1')
      }
    )

    it(
      'defaults permission conservatively to unknown',
      () => {
        const result =
          universalCompletionAdapter.normalize(
            ORG_ID,
            {
              event_id:
                'event-unknown-consent',
              location_id:
                LOCATION_ID,
              completed_at:
                '2026-09-19T08:30:00Z',
              country: 'CA',
              customer: {
                first_name: 'Bob',
                email:
                  'bob@example.test',
              },
            }
          )

        expect(result.valid).toBe(true)

        expect(
          result.canonical
            ?.permission.email
        ).toBe('unknown')

        expect(
          result.canonical
            ?.permission.sms
        ).toBe('unknown')
      }
    )

    it(
      'rejects invalid schema instead of inventing completion data',
      () => {
        const result =
          normalizeUniversalCompletionInput(
            ORG_ID,
            {
              event_id: ' ',
              location_id: 'not-a-uuid',
              completed_at:
                'not-a-date',
              country: 'USA',
              customer: {
                first_name: '',
                email: 'bad-email',
              },
            }
          )

        expect(result.valid).toBe(false)

        expect(result.errors).toEqual(
          expect.objectContaining({
            event_id:
              expect.any(String),
            location_id:
              expect.any(String),
            completed_at:
              expect.any(String),
            country:
              expect.any(String),
            first_name:
              expect.any(String),
            email:
              expect.any(String),
          })
        )
      }
    )
  }
)

describe(
  'MR-3A completion API authentication',
  () => {
    it(
      'parses the versioned bearer API key',
      () => {
        const parsed =
          parseCompletionApiKey(
            `Bearer mpg_v1.${CREDENTIAL_ID}.${SECRET}`
          )

        expect(parsed).toEqual({
          credentialId:
            CREDENTIAL_ID,
          secret: SECRET,
        })
      }
    )

    it(
      'stores only a one-way secret hash and compares it safely',
      () => {
        const hash =
          hashCompletionApiSecret(
            SECRET
          )

        expect(hash).toMatch(
          /^[0-9a-f]{64}$/
        )

        expect(
          verifyCompletionApiSecret(
            SECRET,
            hash
          )
        ).toBe(true)

        expect(
          verifyCompletionApiSecret(
            `${SECRET}tampered`,
            hash
          )
        ).toBe(false)
      }
    )

    it(
      'signs the exact raw body, timestamp and nonce',
      () => {
        const rawBody =
          '{"event_id":"evt-123"}'

        const timestamp =
          '1789800000'

        const nonce =
          'nonce-1234567890123456'

        const signature =
          signCompletionRequest(
            SECRET,
            timestamp,
            nonce,
            rawBody
          )

        expect(
          verifyCompletionRequestSignature(
            SECRET,
            timestamp,
            nonce,
            rawBody,
            signature
          )
        ).toBe(true)

        expect(
          verifyCompletionRequestSignature(
            SECRET,
            timestamp,
            nonce,
            rawBody +
              '{"tampered":true}',
            signature
          )
        ).toBe(false)
      }
    )

    it(
      'enforces bounded timestamp freshness and nonce shape',
      () => {
        const nowMs =
          Date.parse(
            '2026-09-19T08:00:00Z'
          )

        const fresh =
          String(
            Math.floor(
              nowMs / 1000
            )
          )

        const stale =
          String(
            Math.floor(
              (nowMs -
                6 * 60 * 1000) /
                1000
            )
          )

        expect(
          isFreshCompletionTimestamp(
            fresh,
            nowMs
          )
        ).toBe(true)

        expect(
          isFreshCompletionTimestamp(
            stale,
            nowMs
          )
        ).toBe(false)

        expect(
          isValidCompletionNonce(
            'nonce-1234567890123456'
          )
        ).toBe(true)

        expect(
          isValidCompletionNonce(
            'short'
          )
        ).toBe(false)
      }
    )

    it(
      'produces a stable raw-body correlation hash',
      () => {
        const first =
          hashCompletionRequestBody(
            '{"a":1}'
          )

        const second =
          hashCompletionRequestBody(
            '{"a":1}'
          )

        const changed =
          hashCompletionRequestBody(
            '{"a":2}'
          )

        expect(first).toBe(second)
        expect(first).not.toBe(
          changed
        )
      }
    )
  }
)

describe('MR-3 universal completion HTTP handler', () => {
  const validPayload = {
    event_id: 'evt-happy-100',
    location_id: LOCATION_ID,
    completed_at: '2026-09-19T10:00:00Z',
    country: 'CA',
    customer: {
      first_name: 'Jordan',
      last_name: 'Taylor',
      email: 'jordan.taylor@example.test',
      phone: '+15559876543',
      source_customer_id: 'cust-99',
    },
    transaction_id: 'tx-555',
    permission: {
      email: 'allowed' as const,
      sms: 'unknown' as const,
    },
  }

  function createMockStore(overrides: Partial<import('../../src/domain/completion/api-handler').CompletionApiStore> = {}): import('../../src/domain/completion/api-handler').CompletionApiStore {
    return {
      async getCredential(credentialId: string) {
        if (credentialId !== CREDENTIAL_ID) return null
        return {
          id: CREDENTIAL_ID,
          organizationId: ORG_ID,
          secretHash: hashCompletionApiSecret(SECRET),
          status: 'ACTIVE',
        }
      },
      async claimIngestion() {
        return {
          accepted: true,
          replay: false,
          rate_limited: false,
          stale: false,
          ingestion_id: 'ingest-1111-2222-3333',
        }
      },
      async getActivationContext() {
        return {
          location: { id: LOCATION_ID, status: 'ACTIVE' },
          destination: {
            location_id: LOCATION_ID,
            status: 'CONFIRMED',
            canonical_url: 'https://g.page/r/test-sample/review',
          },
        }
      },
      async submitCompletion() {
        return {
          duplicate: false,
          customerId: 'cust-uuid-1234',
          completionEventId: 'comp-uuid-5678',
          outboxId: 'outbox-uuid-9012',
          sourceEventId: 'evt-happy-100',
        }
      },
      async finalizeIngestion() {
        // no-op mock
      },
      ...overrides,
    }
  }

  function makeRequest({
    body = JSON.stringify(validPayload),
    credentialId = CREDENTIAL_ID,
    secret = SECRET,
    timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = 'nonce-unique-1234567890',
    authHeader,
    sigHeader,
    omitTimestamp = false,
    omitNonce = false,
  }: {
    body?: string
    credentialId?: string
    secret?: string
    timestamp?: string
    nonce?: string
    authHeader?: string
    sigHeader?: string
    omitTimestamp?: boolean
    omitNonce?: boolean
  }): Request {
    const auth = authHeader !== undefined ? authHeader : `Bearer mpg_v1.${credentialId}.${secret}`
    const calculatedSig = signCompletionRequest(secret, timestamp, nonce, body)
    const signature = sigHeader !== undefined ? sigHeader : calculatedSig

    const headers = new Headers()
    if (auth) headers.set('authorization', auth)
    if (!omitTimestamp) headers.set('x-mpg-timestamp', timestamp)
    if (!omitNonce) headers.set('x-mpg-nonce', nonce)
    if (signature) headers.set('x-mpg-signature', signature)
    headers.set('content-type', 'application/json')
    headers.set('content-length', String(Buffer.byteLength(body, 'utf8')))

    return new Request('https://api.example.test/api/v1/completions', {
      method: 'POST',
      headers,
      body,
    })
  }

  it('rejects malformed authorization header', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ authHeader: 'Basic dXNlcjpwYXNz' })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('UNAUTHORIZED')
  })

  it('rejects malformed API key token structure', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ authHeader: 'Bearer not-an-mpg-key' })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(401)
  })

  it('rejects unknown credential ID', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getCredential() {
        return null
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('UNAUTHORIZED')
  })

  it('rejects revoked credential', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getCredential() {
        return {
          id: CREDENTIAL_ID,
          organizationId: ORG_ID,
          secretHash: hashCompletionApiSecret(SECRET),
          status: 'REVOKED',
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('UNAUTHORIZED')
  })

  it('rejects incorrect secret in credential bearer token', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({
      authHeader: `Bearer mpg_v1.${CREDENTIAL_ID}.wrong_secret_12345678901234567890`,
      secret: 'wrong_secret_12345678901234567890',
    })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(401)
  })

  it('rejects invalid HMAC signature', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({
      sigHeader: 'v1=0000000000000000000000000000000000000000000000000000000000000000',
    })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('UNAUTHORIZED')
  })

  it('rejects HMAC body tampering', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    // Generate valid signature for original body, then alter the body in the request
    const originalBody = JSON.stringify(validPayload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = 'nonce-tamper-check-12345'
    const sig = signCompletionRequest(SECRET, timestamp, nonce, originalBody)

    const tamperedBody = JSON.stringify({ ...validPayload, customer: { ...validPayload.customer, email: 'hacked@example.test' } })

    const headers = new Headers()
    headers.set('authorization', `Bearer mpg_v1.${CREDENTIAL_ID}.${SECRET}`)
    headers.set('x-mpg-timestamp', timestamp)
    headers.set('x-mpg-nonce', nonce)
    headers.set('x-mpg-signature', sig)
    headers.set('content-type', 'application/json')

    const req = new Request('https://api.example.test/api/v1/completions', {
      method: 'POST',
      headers,
      body: tamperedBody,
    })

    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('UNAUTHORIZED')
  })

  it('rejects missing timestamp header', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ omitTimestamp: true })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('INVALID_SECURITY_HEADERS')
  })

  it('rejects malformed timestamp header', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ timestamp: 'not-a-timestamp' })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('INVALID_SECURITY_HEADERS')
  })

  it('rejects stale timestamp older than 5 minutes', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const staleTimestamp = String(Math.floor((Date.now() - 360 * 1000) / 1000))
    const req = makeRequest({ timestamp: staleTimestamp })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('STALE_REQUEST')
  })

  it('rejects future timestamp farther than 5 minutes ahead', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const futureTimestamp = String(Math.floor((Date.now() + 360 * 1000) / 1000))
    const req = makeRequest({ timestamp: futureTimestamp })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('STALE_REQUEST')
  })

  it('rejects missing nonce header', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ omitNonce: true })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('INVALID_SECURITY_HEADERS')
  })

  it('rejects malformed nonce (<16 characters or invalid chars)', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ nonce: 'short-nonce' })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('INVALID_SECURITY_HEADERS')
  })

  it('rejects replayed nonce with 409 Conflict', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async claimIngestion() {
        return {
          accepted: false,
          replay: true,
          rate_limited: false,
          stale: false,
          ingestion_id: 'prior-ingestion-id',
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('REPLAY_DETECTED')
  })

  it('rejects rate-limited organization requests with 429', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async claimIngestion() {
        return {
          accepted: false,
          replay: false,
          rate_limited: true,
          stale: false,
          ingestion_id: null,
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.error).toBe('RATE_LIMITED')
  })

  it('rejects oversized request body (>64KB) with 413', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const bigString = 'x'.repeat(65 * 1024)
    const req = makeRequest({ body: bigString })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toBe('PAYLOAD_TOO_LARGE')
  })

  it('rejects malformed JSON payload with 400', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const req = makeRequest({ body: '{"event_id": unclosed' })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('INVALID_JSON')
  })

  it('rejects invalid completion payload missing event_id with 422', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const invalid = { ...validPayload, event_id: '' }
    const req = makeRequest({ body: JSON.stringify(invalid) })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error).toBe('INVALID_COMPLETION_PAYLOAD')
    expect(data.fieldErrors?.event_id).toBeDefined()
  })

  it('rejects invalid email address with 422', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const invalid = { ...validPayload, customer: { ...validPayload.customer, email: 'not-an-email' } }
    const req = makeRequest({ body: JSON.stringify(invalid) })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error).toBe('INVALID_COMPLETION_PAYLOAD')
    expect(data.fieldErrors?.email).toBeDefined()
  })

  it('rejects invalid country code with 422', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const invalid = { ...validPayload, country: 'USA' }
    const req = makeRequest({ body: JSON.stringify(invalid) })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.fieldErrors?.country).toBeDefined()
  })

  it('rejects invalid location UUID with 422', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const invalid = { ...validPayload, location_id: 'bad-uuid' }
    const req = makeRequest({ body: JSON.stringify(invalid) })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.fieldErrors?.location_id).toBeDefined()
  })

  it('rejects invalid permission value with 422', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const invalid = { ...validPayload, permission: { email: 'invalid_choice' as unknown as import('../../src/domain/completion').PermissionState } }
    const req = makeRequest({ body: JSON.stringify(invalid) })
    const res = await handleCompletionApiRequest(req, createMockStore())
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.fieldErrors?.permission_email).toBeDefined()
  })

  it('rejects location not belonging to organization / not found with 409', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getActivationContext() {
        return { location: null, destination: null }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('LOCATION_NOT_READY')
  })

  it('rejects inactive location with 409', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getActivationContext() {
        return {
          location: { id: LOCATION_ID, status: 'SUSPENDED' },
          destination: {
            location_id: LOCATION_ID,
            status: 'CONFIRMED',
            canonical_url: 'https://g.page/r/test-sample/review',
          },
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('LOCATION_NOT_READY')
  })

  it('rejects location without Google review destination with 409', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getActivationContext() {
        return {
          location: { id: LOCATION_ID, status: 'ACTIVE' },
          destination: null,
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('LOCATION_NOT_READY')
  })

  it('rejects unconfirmed Google review destination with 409', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getActivationContext() {
        return {
          location: { id: LOCATION_ID, status: 'ACTIVE' },
          destination: {
            location_id: LOCATION_ID,
            status: 'PENDING',
            canonical_url: 'https://g.page/r/test-sample/review',
          },
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('LOCATION_NOT_READY')
  })

  it('rejects CONFIRMED destination with invalid/malicious non-Google URL with 409', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async getActivationContext() {
        return {
          location: { id: LOCATION_ID, status: 'ACTIVE' },
          destination: {
            location_id: LOCATION_ID,
            status: 'CONFIRMED',
            canonical_url: 'https://evil.example.com/fake-google-review',
          },
        }
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe('LOCATION_NOT_READY')
  })

  it('accepts valid completion with 202 Accepted and returns canonical event ID', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const finalizedAuditRef: { current: import('../../src/domain/completion/api-handler').CompletionIngestionFinalize | null } = { current: null }
    const store = createMockStore({
      async finalizeIngestion(input) {
        finalizedAuditRef.current = input
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(202)
    const data = await res.json()
    expect(data.accepted).toBe(true)
    expect(data.duplicate).toBe(false)
    expect(data.eventId).toBe('comp-uuid-5678')
    expect(data.sourceEventId).toBe('evt-happy-100')
    expect(finalizedAuditRef.current?.status).toBe('ACCEPTED')
    expect(finalizedAuditRef.current?.httpStatus).toBe(202)
  })

  it('returns idempotent 200 OK for duplicate source events', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const finalizedAuditRef: { current: import('../../src/domain/completion/api-handler').CompletionIngestionFinalize | null } = { current: null }
    const store = createMockStore({
      async submitCompletion() {
        return {
          duplicate: true,
          customerId: 'cust-uuid-1234',
          completionEventId: 'comp-uuid-5678',
          outboxId: 'outbox-uuid-9012',
          sourceEventId: 'evt-happy-100',
        }
      },
      async finalizeIngestion(input) {
        finalizedAuditRef.current = input
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.accepted).toBe(true)
    expect(data.duplicate).toBe(true)
    expect(data.eventId).toBe('comp-uuid-5678')
    expect(finalizedAuditRef.current?.status).toBe('DUPLICATE')
    expect(finalizedAuditRef.current?.httpStatus).toBe(200)
  })

  it('handles atomic persistence failure safely with 500 SERVER_ERROR', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const finalizedAuditRef: { current: import('../../src/domain/completion/api-handler').CompletionIngestionFinalize | null } = { current: null }
    const store = createMockStore({
      async submitCompletion() {
        throw new Error('Database serialization conflict')
      },
      async finalizeIngestion(input) {
        finalizedAuditRef.current = input
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('SERVER_ERROR')
    expect(finalizedAuditRef.current?.status).toBe('FAILED')
    expect(finalizedAuditRef.current?.errorCode).toBe('COMPLETION_PERSIST_FAILED')
  })

  it('handles activation lookup failure safely with 500 SERVER_ERROR', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const finalizedAuditRef: { current: import('../../src/domain/completion/api-handler').CompletionIngestionFinalize | null } = { current: null }
    const store = createMockStore({
      async getActivationContext() {
        throw new Error('Network timeout to database')
      },
      async finalizeIngestion(input) {
        finalizedAuditRef.current = input
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('SERVER_ERROR')
    expect(finalizedAuditRef.current?.status).toBe('FAILED')
    expect(finalizedAuditRef.current?.errorCode).toBe('ACTIVATION_LOOKUP_FAILED')
  })

  it('ensures errors never leak secrets or sensitive internal details', async () => {
    const { handleCompletionApiRequest } = await import('../../src/domain/completion/api-handler')
    const store = createMockStore({
      async submitCompletion() {
        throw new Error(`Secret leaked: ${SECRET}`)
      },
    })
    const req = makeRequest({})
    const res = await handleCompletionApiRequest(req, store)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(hashCompletionApiSecret(SECRET))
    expect(text).not.toContain('Database')
  })
})
