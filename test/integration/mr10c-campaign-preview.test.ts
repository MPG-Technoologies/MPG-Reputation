import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CAMPAIGN_BRIEFS,
  CAMPAIGN_PREVIEW_LINKS,
  auditDraftCampaigns,
  getCampaignBrief,
  type CampaignBrief,
  type CampaignPreviewLink,
} from "../../src/components/marketing/campaign-briefs";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("MR-10C prelaunch campaign planning", () => {
  it("includes factual, distinct draft concepts rather than a live campaign", () => {
    expect(CAMPAIGN_BRIEFS.length).toBe(3);
    expect(new Set(CAMPAIGN_BRIEFS.map((brief) => brief.id)).size).toBe(3);
    expect(CAMPAIGN_BRIEFS.every((brief) => brief.status === "DRAFT_ONLY")).toBe(true);
    expect(auditDraftCampaigns()).toEqual([]);
  });

  it("keeps CTA links on existing educational website routes", () => {
    for (const brief of CAMPAIGN_BRIEFS) {
      expect(CAMPAIGN_PREVIEW_LINKS).toContain(brief.creative.ctaHref);
      expect(brief.creative.ctaHref).not.toMatch(/signup|checkout|billing|admin|api/);
    }
    expect(CAMPAIGN_PREVIEW_LINKS).toContain("/reputation-check");
  });

  it("provides educational messaging rather than misleading promises", () => {
    const copy = CAMPAIGN_BRIEFS.map((brief) => brief.creative.explanation).join(" ");
    expect(copy).toContain("does not establish that Google published a review");
    expect(copy).toContain("No business answers are submitted or stored");
    expect(copy).not.toMatch(/30 Free Reviews\b|guaranteed? 5.star|guaranteed? positive reviews/i);
    expect(CAMPAIGN_BRIEFS.every((brief) => brief.reviewNotes.length > 0)).toBe(true);
  });

  it("retrieves a known campaign and rejects missing identifiers", () => {
    expect(getCampaignBrief("consistent-followup")?.status).toBe("DRAFT_ONLY");
    expect(getCampaignBrief("unknown")).toBeUndefined();
  });

  it("catches duplicated IDs, unsafe claims, and unapproved links", () => {
    const a = CAMPAIGN_BRIEFS[0];
    const duplicate: CampaignBrief = { ...a };
    expect(auditDraftCampaigns([a, duplicate])).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate campaign ID/)]),
    );

    const unsafeClaim: CampaignBrief = {
      ...a,
      creative: { ...a.creative, headline: "30 Free Reviews" },
    };
    expect(auditDraftCampaigns([unsafeClaim])).toEqual(
      expect.arrayContaining([expect.stringMatching(/Unsupported promise/)]),
    );

    const unsafeLink: CampaignBrief = {
      ...a,
      creative: {
        ...a.creative,
        ctaHref: "/checkout" as CampaignPreviewLink,
      },
    };
    expect(auditDraftCampaigns([unsafeLink])).toEqual(
      expect.arrayContaining([expect.stringMatching(/Unapproved CTA destination/)]),
    );
  });

  it("exposes preview markup only in Next.js development mode", () => {
    const page = read("src/app/mr10-campaign-preview/page.tsx");
    expect(page).toContain('process.env.NODE_ENV !== "development"');
    expect(page).toContain("notFound()");
    expect(page).toContain('dynamic = "force-dynamic"');
    expect(page).toContain("index: false");
    expect(page).toContain("follow: false");
    expect(page).toContain("CAMPAIGN_BRIEFS.map");
  });

  it("does not add live data collection, sending, or signup behavior", () => {
    const files = [
      "src/components/marketing/campaign-briefs.ts",
      "src/app/mr10-campaign-preview/page.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/\bfetch\s*\(|\.sendBeacon\(|localStorage|sessionStorage|document\.cookie|\.from\(|supabase|\/api\/|<form\b|resend|stripe|inngest/i);
    }
    const tracker = read("src/components/marketing/funnel.ts");
    expect(tracker).toContain("No analytics, logging, transmission, cookies, or storage");
  });
});
