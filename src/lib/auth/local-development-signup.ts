/**
 * Prelaunch self-signup boundary for the application's existing Auth flow.
 *
 * Only the isolated LOCAL Supabase CLI instance may be used for creating
 * development accounts through the app. This is NOT a hosted Auth signup
 * policy: Supabase's own signup endpoint must be disabled independently
 * before any external staging, pilot, or commercial exposure.
 */
const LOCAL_SUPABASE_ORIGINS = new Set([
  "http://127.0.0.1:54331",
  "http://localhost:54331",
]);

export function canCreateLocalDevelopmentAccount(
  nodeEnv: string | undefined,
  supabaseUrl: string | undefined,
): boolean {
  // Fail closed if the endpoint is unspecified, even though existing
  // application clients have a localhost fallback.
  if (nodeEnv !== "development" || !supabaseUrl) return false;

  try {
    const url = new URL(supabaseUrl);
    return (
      LOCAL_SUPABASE_ORIGINS.has(url.origin) &&
      url.protocol === "http:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
