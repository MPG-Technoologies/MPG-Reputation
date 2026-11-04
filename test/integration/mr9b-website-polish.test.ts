import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildReport } from "../../src/components/marketing/buildReport";
import type { ReputationCheckInput } from "../../src/components/marketing/reputation-contracts";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("MR-9B customer journey polishing", () => {
  it("presents professional pricing copy with no invented prices or checkout", () => {
    const pricing = read("src/components/marketing/Pricing.tsx");
    expect(pricing).toContain("Pricing designed to grow with your business");
    expect(pricing).toContain("Details coming");
    expect(pricing).toContain("30 Free Review Requests");
    expect(pricing).toContain("not available in this preview");
    expect(pricing).not.toContain("Pricing will be published here when");
    expect(pricing).not.toContain("Price TBD");
    expect(pricing).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage/);
  });

  it("lets a visitor complete the assessment without identifying the business", () => {
    const check = read("src/components/marketing/ReputationCheck.tsx");
    expect(check).toContain('Business name <span className="text-ink-mute">(optional)</span>');
    expect(check).toContain('businessName: form.businessName.trim() || "Your business"');
    expect(check).not.toContain("Enter your business name (at least 2 characters).");
    expect(check).toContain("not verified Google review data");
    expect(check).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage|indexedDB/);
  });

  it("produces a transparent derived report from only provided answers", () => {
    const input: ReputationCheckInput = {
      businessName: "Your business",
      businessCategory: "Home services",
      locations: "one",
      googleRating: null,
      reviewCount: null,
      monthlyJobs: "25_75",
      requestProcess: "sometimes",
      followUp: "never",
      tracking: "none",
      software: "None / paper & spreadsheets",
      gaps: [],
    };
    const result = buildReport(input);
    expect(result.businessName).toBe("Your business");
    expect(result.consistencyBand).toBe("ad_hoc");
    expect(result.estimatedMonthlyOpportunities).toBe(50);
    expect(result.sections.some((item) => item.id === "limitations")).toBe(true);
  });

  it("labels report derivations honestly and connects the same CTA names", () => {
    expect(read("src/components/marketing/ReputationReport.tsx")).toContain("Derived from answers");
    expect(read("src/components/marketing/site/SiteNav.tsx")).toContain("Free Reputation Check");
    expect(read("src/components/marketing/Home.tsx")).not.toContain("Check Your Reputation");
    const report = read("src/components/marketing/site/ConversionNextSteps.tsx");
    expect(report).toContain('href="/pricing"');
    expect(report).toContain("trialInfoOpen");
    expect(report).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage/);
  });
});
