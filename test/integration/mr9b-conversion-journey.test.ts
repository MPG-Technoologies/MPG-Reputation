import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const routes = [
  "",
  "features",
  "how-it-works",
  "pricing",
  "faq",
  "trust",
  "resources",
  "reputation-check",
  "reputation-report",
];

describe("MR-9B prelaunch acquisition journey", () => {
  it("provides the complete set of marketing routes without indexing", () => {
    for (const route of routes) {
      const page = `src/app/${route ? `${route}/` : ""}page.tsx`;
      expect(fs.existsSync(path.join(root, page)), page).toBe(true);
      expect(read(page), page).toContain("index: false");
    }
  });

  it("connects homepage, features, assessment and public navigation", () => {
    const home = read("src/components/marketing/Home.tsx");
    const features = read("src/components/marketing/Features.tsx");
    const nav = read("src/components/marketing/site/SiteNav.tsx");
    expect(home).toContain('href="/features"');
    expect(home).toContain('href="/reputation-check"');
    expect(features).toContain('href="/reputation-check"');
    expect(nav).toContain('href: "/faq"');
    expect(nav).toContain('href: "/pricing"');
    expect(nav).toContain('href="/login"');
  });

  it("connects both reports to relevant next steps without persistent acquisition", () => {
    const check = read("src/components/marketing/ReputationCheck.tsx");
    const example = read("src/components/marketing/ReputationReport.tsx");
    const steps = read("src/components/marketing/site/ConversionNextSteps.tsx");
    expect(check).toContain("setReport(buildReport(input))");
    expect(check).toContain('<ConversionNextSteps origin="check" />');
    expect(example).toContain('<ConversionNextSteps origin="example" />');
    expect(steps).toContain('href="/pricing"');
    expect(steps).toContain('href={isExample ? "/reputation-check" : "/features"}');
    expect(steps).toContain("<StagingCtaDialog");
    expect(steps).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage|indexedDB|trpc|registerInterest/i);
  });

  it("tells the truth about trial access and does not claim to register visitors", () => {
    const faq = read("src/components/marketing/Faq.tsx");
    const pricing = read("src/components/marketing/Pricing.tsx");
    const dialog = read("src/components/marketing/site/StagingCtaDialog.tsx");
    expect(faq).not.toContain("register an anonymous interest signal");
    expect(faq).toContain("No interest signal is recorded");
    expect(pricing).not.toContain("Register anonymous trial interest");
    expect(pricing).toContain("Check trial availability");
    expect(dialog).toContain("Trial access is not publicly available yet");
    expect(dialog).toContain("30 Free Review Requests");
    expect(dialog).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage/);
  });

  it("traps keyboard focus in the informational dialog and restores previous focus", () => {
    const dialog = read("src/components/marketing/site/StagingCtaDialog.tsx");
    expect(dialog).toContain("previousFocusRef.current?.focus()");
    expect(dialog).toContain('event.key === "Tab"');
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('ref={dialogRef}');
  });

  it("preserves all protected app and acquisition boundaries", () => {
    for (const file of [
      "src/components/marketing/site/ConversionNextSteps.tsx",
      "src/components/marketing/ReputationCheck.tsx",
      "src/components/marketing/ReputationReport.tsx",
      "src/components/marketing/Pricing.tsx",
      "src/components/marketing/Faq.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/from ["'](?:react-router|@trpc|drizzle-orm|mysql2|@\/providers\/trpc)/);
    }
    expect(read("src/components/marketing/funnel.ts")).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage/);
  });
});
