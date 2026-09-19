import type { EmailProvider } from './types'
import { ConsoleEmailProvider } from './console'
import { ResendEmailProvider } from './resend'

export * from './types'
export * from './console'
export * from './resend'

export function isValidEmailAddress(address: string | undefined): boolean {
  if (!address || typeof address !== 'string') return false
  const trimmed = address.trim()
  return Boolean(trimmed.includes('@') && trimmed.indexOf('@') > 0 && trimmed.indexOf('@') < trimmed.length - 1)
}

/**
 * Returns configured EmailProvider.
 *
 * SECURITY INVARIANT (Section 2 & 4):
 * Live Resend sending requires ALL FOUR conditions:
 * 1. EMAIL_PROVIDER=resend
 * 2. RESEND_API_KEY set and non-empty
 * 3. EMAIL_FROM_ADDRESS set and structurally valid
 * 4. ENABLE_LIVE_EMAIL=true (explicit live sending switch)
 *
 * Without ALL FOUR true, ConsoleEmailProvider is strictly used as safe default.
 * Missing or invalid EMAIL_FROM_ADDRESS causes live sender selection to fail closed.
 */
export function getEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER?.toLowerCase()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim()
  const enableLiveEmail = process.env.ENABLE_LIVE_EMAIL === 'true'

  if (providerType === 'resend' && apiKey && isValidEmailAddress(fromAddress) && enableLiveEmail) {
    return new ResendEmailProvider(apiKey, fromAddress!)
  }

  // Safe default: ConsoleEmailProvider for all local dev & test runs
  return new ConsoleEmailProvider()
}
