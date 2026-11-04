import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("MR-9 prelaunch public marketing website", () => {
  const routes = ["", "features", "how-it-works", "pricing", "faq", "trust", "resources", "reputation-check", "reputation-report"];
  it("keeps every public route non-indexable before owner approval", () => {
    for (const route of routes) {
      const p = `src/app/${route ? route + "/" : ""}page.tsx`;
      expect(read(p)).toContain("index: false");
    }
  });
  it("reuses the accepted login rather than the Kimi OAuth flow", () => {
    const nav = read("src/components/marketing/site/SiteNav.tsx");
    expect(nav).toContain('href="/login"');
    expect(nav).not.toContain("useAuth");
    expect(nav).not.toContain("oauth");
  });
  it("keeps the reputation check local without storage, network requests, or arbitrary report lookups", () => {
    const assessment = read("src/components/marketing/ReputationCheck.tsx");
    expect(assessment).toContain("setReport(buildReport(input))");
    expect(assessment).not.toMatch(/trpc|fetch\(|localStorage|sessionStorage|indexedDB|navigate\(|getCheck/);
    expect(read("src/components/marketing/site/StagingCtaDialog.tsx")).not.toMatch(/trpc|fetch\(|localStorage|sessionStorage/);
  });
  it("does not adopt the Kimi backend, Kimi auth, or React Router", () => {
    for (const file of fs.readdirSync(path.join(root, "src/components/marketing"))) {
      if (!/\.(tsx?|jsx?)$/.test(file)) continue;
      const content = read(`src/components/marketing/${file}`);
      expect(content).not.toMatch(/from ["'](react-router|@trpc|drizzle-orm|mysql2|@\/providers\/trpc)/);
    }
  });
  it("preserves correct trial wording and no marketing transmissions", () => {
    expect(read("src/components/marketing/Home.tsx")).toContain("30 Free Review Requests");
    const funnel = read("src/components/marketing/funnel.ts");
    expect(funnel).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage/);
  });
});
