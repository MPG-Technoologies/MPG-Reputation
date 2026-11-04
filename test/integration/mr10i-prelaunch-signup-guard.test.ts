import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canCreateLocalDevelopmentAccount } from "../../src/lib/auth/local-development-signup";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("MR-10I prelaunch account creation safety", () => {
  const localUrls = [
    "http://localhost:54331",
    "http://127.0.0.1:54331",
    "http://localhost:54331/",
    "http://127.0.0.1:54331/",
  ];

  it("allows development account creation only against the isolated local CLI", () => {
    for (const url of localUrls) {
      expect(canCreateLocalDevelopmentAccount("development", url)).toBe(true);
    }
  });

  it("rejects local signup in production, test, staging and absent environment", () => {
    for (const env of ["production", "test", "staging", "", undefined]) {
      for (const url of localUrls) {
        expect(canCreateLocalDevelopmentAccount(env, url)).toBe(false);
      }
    }
  });

  it("rejects hosted Supabase even if Next.js is running in development", () => {
    for (const url of [
      "https://example.supabase.co",
      "https://example.supabase.co/",
      "http://example.supabase.co",
      "https://127.0.0.1:54331",
      "http://127.0.0.1:54321",
      "http://localhost:3000",
      "http://localhost.evil.invalid:54331",
      "http://192.168.0.1:54331",
      "http://[::1]:54331",
    ]) {
      expect(canCreateLocalDevelopmentAccount("development", url)).toBe(false);
    }
  });

  it("rejects malformed, ambiguous or modified local Supabase origins", () => {
    for (const url of [
      undefined,
      "",
      "localhost:54331",
      "http://localhost:54331/v1",
      "http://localhost:54331?x=1",
      "http://localhost:54331/#dashboard",
      "http://user@localhost:54331",
      "http://user:password@localhost:54331",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(canCreateLocalDevelopmentAccount("development", url)).toBe(false);
    }
  });

  it("guards the existing server action before reading submitted credentials or creating a client", () => {
    const source = read("src/actions/auth.ts");
    const signup = source.slice(source.indexOf("export async function signUp"));
    const guardPos = signup.indexOf("if (!canCreateLocalDevelopmentAccount(");
    const credentialsPos = signup.indexOf("formData.get('email')");
    const clientPos = signup.indexOf("const supabase = await createClient()");
    const backendPos = signup.indexOf("supabase.auth.signUp(");
    expect(guardPos).toBeGreaterThanOrEqual(0);
    expect(credentialsPos).toBeGreaterThan(guardPos);
    expect(clientPos).toBeGreaterThan(guardPos);
    expect(backendPos).toBeGreaterThan(clientPos);
    expect(signup).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
    expect(signup).toContain("process.env.NODE_ENV");
    expect(signup).toContain("redirect('/login?message=Account%20creation%20is%20not%20available')");
    expect(source).toContain("supabase.auth.signInWithPassword({");
    expect(source).toContain("export async function signOut(");
    expect(source).not.toMatch(/service.role|admin\.createUser|SUPABASE_SERVICE_ROLE_KEY/i);
  });

  it("keeps the account creation button conditional while preserving sign-in", () => {
    const source = read("src/app/login/page.tsx");
    expect(source).toContain("const allowLocalSignup = canCreateLocalDevelopmentAccount(");
    expect(source).toContain("{allowLocalSignup ? (");
    expect(source).toContain("formAction={signUp}");
    expect(source).toContain("formAction={signIn}");
    expect(source).toContain("Create Development Account");
    expect(source).toContain("Existing authorized users can sign in.");
  });

  it("preserves local test/bootstrap configuration without modifying hosted settings", () => {
    const localConfig = read("supabase/config.toml");
    expect(localConfig).toContain("enable_signup = true");
    const bootstrap = read("scripts/bootstrap-local-dev.mjs");
    expect(bootstrap).toContain("assertAllowedLocalSupabaseUrl");
    const policy = read("src/lib/auth/local-development-signup.ts");
    expect(policy).toContain("LOCAL_SUPABASE_ORIGINS");
    expect(policy).not.toMatch(/service.role|auth\.admin|fetch\(|supabase\.auth\./i);
  });
});
