import { describe, it, expect } from 'vitest'
import { determineReviewRequestTransition } from '../../src/domain/review-request/transitions'

describe('Review Request State Transitions (MR-1A Lifecycle Invariants)', () => {
  describe('email.sent transitions', () => {
    it('transitions SCHEDULED to SENT', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SCHEDULED',
        eventType: 'email.sent',
      })
      expect(result.nextStatus).toBe('SENT')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSuppressContact).toBe(false)
    })

    it('transitions SENDING to SENT', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENDING',
        eventType: 'email.sent',
      })
      expect(result.nextStatus).toBe('SENT')
      expect(result.statusChanged).toBe(true)
    })

    it('does NOT regress DELIVERED on late email.sent', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'DELIVERED',
        eventType: 'email.sent',
      })
      expect(result.nextStatus).toBe('DELIVERED')
      expect(result.statusChanged).toBe(false)
    })

    it('does NOT regress CLICKED on email.sent', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'CLICKED',
        eventType: 'email.sent',
      })
      expect(result.nextStatus).toBe('CLICKED')
      expect(result.statusChanged).toBe(false)
    })
  })

  describe('email.delivered transitions', () => {
    it('transitions SENT to DELIVERED and flags delivery timestamp', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.delivered',
      })
      expect(result.nextStatus).toBe('DELIVERED')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSetDeliveredAt).toBe(true)
    })

    it('transitions SENDING directly to DELIVERED if sent webhook arrived late/out of order', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENDING',
        eventType: 'email.delivered',
      })
      expect(result.nextStatus).toBe('DELIVERED')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSetDeliveredAt).toBe(true)
    })

    it('handles duplicate email.delivered idempotently without changing status', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'DELIVERED',
        eventType: 'email.delivered',
      })
      expect(result.nextStatus).toBe('DELIVERED')
      expect(result.statusChanged).toBe(false)
      expect(result.shouldSetDeliveredAt).toBe(false)
    })

    it('preserves CLICKED when late email.delivered arrives', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'CLICKED',
        eventType: 'email.delivered',
      })
      expect(result.nextStatus).toBe('CLICKED')
      expect(result.statusChanged).toBe(false)
      // MR-1A.2 Section 7 & 8: truthfully record delivered_at while preserving status CLICKED
      expect(result.shouldSetDeliveredAt).toBe(true)
    })
  })

  describe('email.delivery_delayed transitions', () => {
    it('preserves current state without falsely marking FAILED or regressing', () => {
      const sendingResult = determineReviewRequestTransition({
        currentStatus: 'SENDING',
        eventType: 'email.delivery_delayed',
      })
      expect(sendingResult.nextStatus).toBe('SENDING')
      expect(sendingResult.statusChanged).toBe(false)

      const sentResult = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.delivery_delayed',
      })
      expect(sentResult.nextStatus).toBe('SENT')
      expect(sentResult.statusChanged).toBe(false)

      const delivResult = determineReviewRequestTransition({
        currentStatus: 'DELIVERED',
        eventType: 'email.delivery_delayed',
      })
      expect(delivResult.nextStatus).toBe('DELIVERED')
      expect(delivResult.statusChanged).toBe(false)
    })
  })

  describe('email.bounced transitions', () => {
    it('permanent hard bounce marks request FAILED and flags PROVIDER_HARD_BOUNCE suppression', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.bounced',
        bounceType: 'Permanent',
      })
      expect(result.nextStatus).toBe('FAILED')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSuppressContact).toBe(true)
      expect(result.suppressionReason).toBe('PROVIDER_HARD_BOUNCE')
    })

    it('transient bounce marks request FAILED but does NOT permanently suppress contact', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.bounced',
        bounceType: 'Transient',
      })
      expect(result.nextStatus).toBe('FAILED')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSuppressContact).toBe(false)
      expect(result.suppressionReason).toBeUndefined()
    })

    it('undetermined bounce marks request FAILED but does NOT permanently suppress contact', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.bounced',
        bounceType: 'Undetermined',
      })
      expect(result.nextStatus).toBe('FAILED')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSuppressContact).toBe(false)
    })

    it('late bounce preserves CLICKED authority if customer already clicked review link', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'CLICKED',
        eventType: 'email.bounced',
        bounceType: 'Permanent',
      })
      expect(result.nextStatus).toBe('CLICKED')
      expect(result.statusChanged).toBe(false)
      // Suppression should still be recorded for future sends
      expect(result.shouldSuppressContact).toBe(true)
      expect(result.suppressionReason).toBe('PROVIDER_HARD_BOUNCE')
    })
  })

  describe('email.complained transitions', () => {
    it('spam complaint preserves delivery truth but triggers PROVIDER_COMPLAINT suppression', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'DELIVERED',
        eventType: 'email.complained',
      })
      expect(result.nextStatus).toBe('DELIVERED')
      expect(result.statusChanged).toBe(false)
      expect(result.shouldSuppressContact).toBe(true)
      expect(result.suppressionReason).toBe('PROVIDER_COMPLAINT')
    })

    it('complaint preserves CLICKED status and triggers suppression', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'CLICKED',
        eventType: 'email.complained',
      })
      expect(result.nextStatus).toBe('CLICKED')
      expect(result.statusChanged).toBe(false)
      expect(result.shouldSuppressContact).toBe(true)
      expect(result.suppressionReason).toBe('PROVIDER_COMPLAINT')
    })
  })

  describe('email.suppressed transitions', () => {
    it('marks pending/sent request SUPPRESSED and records suppression', () => {
      const result = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.suppressed',
      })
      expect(result.nextStatus).toBe('SUPPRESSED')
      expect(result.statusChanged).toBe(true)
      expect(result.shouldSuppressContact).toBe(true)
      expect(result.suppressionReason).toBe('PROVIDER_SUPPRESSED')
    })

    it('preserves CLICKED and DELIVERED truth on provider suppressed notification', () => {
      const clickedResult = determineReviewRequestTransition({
        currentStatus: 'CLICKED',
        eventType: 'email.suppressed',
      })
      expect(clickedResult.nextStatus).toBe('CLICKED')
      expect(clickedResult.shouldSuppressContact).toBe(true)

      const delivResult = determineReviewRequestTransition({
        currentStatus: 'DELIVERED',
        eventType: 'email.suppressed',
      })
      expect(delivResult.nextStatus).toBe('DELIVERED')
      expect(delivResult.shouldSuppressContact).toBe(true)
    })
  })

  describe('provider email.opened and email.clicked isolation (Section 9)', () => {
    it('ignores email.opened and email.clicked for review activity tracking', () => {
      const openResult = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.opened',
      })
      expect(openResult.nextStatus).toBe('SENT')
      expect(openResult.statusChanged).toBe(false)
      expect(openResult.isIgnoredForReviewActivity).toBe(true)

      const clickResult = determineReviewRequestTransition({
        currentStatus: 'SENT',
        eventType: 'email.clicked',
      })
      expect(clickResult.nextStatus).toBe('SENT')
      expect(clickResult.statusChanged).toBe(false)
      expect(clickResult.isIgnoredForReviewActivity).toBe(true)
    })
  })
})
