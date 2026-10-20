import 'server-only'

/** Deny even standalone provider adapter construction outside disposable TEST.
 * This never authorizes charging, settlements, or paid entitlements.
 * Callers retain their independent explicit feature/role/tenant gates. */
export function isDisposableStripeTestProviderRuntime(): boolean {
  return process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_LIVE_BILLING !== 'true' &&
    ['http://127.0.0.1:54331', 'http://localhost:54331']
      .includes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
}
