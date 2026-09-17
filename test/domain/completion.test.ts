import { describe, it, expect } from 'vitest'
import { normalizeQuickCompleteInput } from '../../src/domain/completion'

describe('normalizeQuickCompleteInput', () => {
  it('normalizes valid Quick Complete input with conservative UNKNOWN consent default', () => {
    const res = normalizeQuickCompleteInput({
      organizationId: 'org-123',
      locationId: 'loc-456',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'Alice.Smith@Example.TEST',
      phone: '555-123-4567',
    })

    expect(res.valid).toBe(true)
    expect(res.canonical).toBeDefined()
    expect(res.canonical?.contact.email).toBe('alice.smith@example.test')
    // Prompt Correction 1: Conservative default is unknown
    expect(res.canonical?.permission.email).toBe('unknown')
    expect(res.canonical?.permission.sms).toBe('unknown')
    expect(res.canonical?.source).toBe('quick_complete')
    expect(res.customerPayload?.first_name).toBe('Alice')
    expect(res.customerPayload?.last_name).toBe('Smith')
    expect(res.customerPayload?.permission_email).toBe('unknown')
  })

  it('preserves explicitly granted email consent', () => {
    const res = normalizeQuickCompleteInput({
      organizationId: 'org-123',
      locationId: 'loc-456',
      firstName: 'Alice',
      email: 'alice@example.test',
      permissionEmail: 'allowed',
    })

    expect(res.valid).toBe(true)
    expect(res.canonical?.permission.email).toBe('allowed')
    expect(res.customerPayload?.permission_email).toBe('allowed')
  })

  it('preserves explicitly denied email consent', () => {
    const res = normalizeQuickCompleteInput({
      organizationId: 'org-123',
      locationId: 'loc-456',
      firstName: 'Alice',
      email: 'alice@example.test',
      permissionEmail: 'denied',
    })

    expect(res.valid).toBe(true)
    expect(res.canonical?.permission.email).toBe('denied')
    expect(res.customerPayload?.permission_email).toBe('denied')
  })

  it('rejects missing first name or invalid email', () => {
    const res1 = normalizeQuickCompleteInput({
      organizationId: 'org-123',
      locationId: 'loc-456',
      firstName: '  ',
      email: 'valid@example.com',
    })
    expect(res1.valid).toBe(false)
    expect(res1.errors?.firstName).toBeDefined()

    const res2 = normalizeQuickCompleteInput({
      organizationId: 'org-123',
      locationId: 'loc-456',
      firstName: 'Alice',
      email: 'not-an-email',
    })
    expect(res2.valid).toBe(false)
    expect(res2.errors?.email).toBeDefined()
  })

  it('preserves explicit client sourceEventId for strict idempotency', () => {
    const res = normalizeQuickCompleteInput({
      organizationId: 'org-123',
      locationId: 'loc-456',
      firstName: 'Bob',
      email: 'bob@example.com',
      sourceEventId: 'custom-idem-uuid-987',
    })
    expect(res.valid).toBe(true)
    expect(res.canonical?.source_event_id).toBe('custom-idem-uuid-987')
  })
})
