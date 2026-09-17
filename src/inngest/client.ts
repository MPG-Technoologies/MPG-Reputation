import { Inngest } from 'inngest'

export type CustomerCompletedEvent = {
  name: 'customer.completed'
  data: {
    eventId?: string
    organizationId: string
    locationId: string
    customerId: string
    sourceEventId: string
    completedAt: string
    country: string
    contact: {
      email: string
      phone?: string | null
    }
    permission: {
      email: 'allowed' | 'unknown' | 'denied'
      sms?: 'allowed' | 'unknown' | 'denied'
      source: string
    }
  }
}

export type InngestEvents = {
  'customer.completed': CustomerCompletedEvent
}

export const inngest = new Inngest({
  id: 'mpg-reputation',
})
