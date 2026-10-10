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
 * Synthetic hosted provider validation (MR-1B-H) requires:
 * 1. EMAIL_PROVIDER=resend
 * 2. RESEND_API_KEY set and non-empty
 * 3. EMAIL_FROM_ADDRESS set and structurally valid
 * 4. ENABLE_LIVE_EMAIL=false
 * 5. ENABLE_SYNTHETIC_EMAIL_VALIDATION=true
 * -> Produces ResendEmailProvider in resend_test_only mode (permits ONLY official Resend test addresses).
 *
 * If both ENABLE_LIVE_EMAIL and ENABLE_SYNTHETIC_EMAIL_VALIDATION are true,
 * the explicit live gate remains authoritative (unrestricted).
 *
 * Without meeting live or synthetic conditions, ConsoleEmailProvider is strictly used as safe default.
 * Missing or invalid EMAIL_FROM_ADDRESS causes live and synthetic sender selection to fail closed.
 */
export function getEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER?.toLowerCase()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim()
  const enableLiveEmail = process.env.ENABLE_LIVE_EMAIL === 'true'
  const enableSyntheticValidation = process.env.ENABLE_SYNTHETIC_EMAIL_VALIDATION === 'true'

  const isResendConfigured =
    providerType === 'resend' &&
    Boolean(apiKey) &&
    isValidEmailAddress(fromAddress)

  if (isResendConfigured && enableLiveEmail) {
    return new ResendEmailProvider(apiKey!, fromAddress!, 'unrestricted')
  }

  if (isResendConfigured && enableSyntheticValidation) {
    return new ResendEmailProvider(apiKey!, fromAddress!, 'resend_test_only')
  }

  // Safe default: ConsoleEmailProvider for all local dev & test runs
  return new ConsoleEmailProvider()
}
