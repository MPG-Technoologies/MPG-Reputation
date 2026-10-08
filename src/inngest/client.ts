import { Inngest } from 'inngest'

export type CustomerCompletedEvent = {
  name: 'customer.completed'
  data: {
    eventId: string
    organizationId: string
    locationId: string
    customerId: string
    sourceEventId: string
  }
}

export type InngestEvents = {
  'customer.completed': CustomerCompletedEvent
}

export const inngest = new Inngest({
  id: 'mpg-reputation',
  isDev: process.env.NODE_ENV !== 'production',
})
