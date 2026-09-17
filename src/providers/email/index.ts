import type { EmailProvider } from './types'
import { ConsoleEmailProvider } from './console'
import { ResendEmailProvider } from './resend'

export * from './types'
export * from './console'
export * from './resend'

/**
 * Returns configured EmailProvider.
 *
 * SECURITY INVARIANT (Prompt Correction 14):
 * Live Resend sending requires ALL THREE:
 * 1. EMAIL_PROVIDER=resend
 * 2. RESEND_API_KEY set and non-empty
 * 3. ENABLE_LIVE_EMAIL=true (explicit live sending switch)
 *
 * Without ENABLE_LIVE_EMAIL=true, ConsoleEmailProvider is strictly used as safe default.
 */
export function getEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER?.toLowerCase()
  const apiKey = process.env.RESEND_API_KEY
  const enableLiveEmail = process.env.ENABLE_LIVE_EMAIL === 'true'

  if (providerType === 'resend' && apiKey && enableLiveEmail) {
    return new ResendEmailProvider(apiKey)
  }

  // Safe default: ConsoleEmailProvider for all local dev & test runs
  return new ConsoleEmailProvider()
}
