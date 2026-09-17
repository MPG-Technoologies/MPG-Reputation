import type { EmailProvider } from './types'
import { ConsoleEmailProvider } from './console'
import { ResendEmailProvider } from './resend'

export * from './types'
export * from './console'
export * from './resend'

export function getEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER?.toLowerCase()
  const apiKey = process.env.RESEND_API_KEY

  if (providerType === 'resend' && apiKey) {
    return new ResendEmailProvider(apiKey)
  }

  // Safe default: ConsoleEmailProvider for all local dev & test runs
  return new ConsoleEmailProvider()
}
