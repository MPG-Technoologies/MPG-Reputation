import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SAMPLE_EDITORIAL_CALENDAR,
  SAMPLE_REVIEW_CHECKPOINTS,
  REVIEW_CHECKPOINT_LABELS,
  inspectSampleEditorialCalendar,
  simulateEditorialReviewProgress,
  type SampleEditorialSlot,
} from "../../src/components/marketing/editorial-calendar";
import { CAMPAIGN_BRIEFS } from "../../src/components/marketing/campaign-briefs";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("MR-10D editorial planning — non-executable samples", () => {
  it("contains only example calendar slots tied to existing draft briefs", () => {
    expect(SAMPLE_EDITORIAL_CALENDAR).toHaveLength(3);
    expect(inspectSampleEditorialCalendar()).toEqual([]);
    expect(SAMPLE_EDITORIAL_CALENDAR.every((s) => s.mode === "SAMPLE_ONLY")).toBe(true);
    for (const slot of SAMPLE_EDITORIAL_CALENDAR) {
      const brief = CAMPAIGN_BRIEFS.find((b) => b.id === slot.campaignId);
      expect(brief?.status).toBe("DRAFT_ONLY");
      expect(brief?.surfaces).toContain(slot.surface);
    }
  });

  it("uses illustrative ISO dates rather than executable scheduling", () => {
    expect(SAMPLE_EDITORIAL_CALENDAR.map((s) => s.proposedDate)).toEqual([
      "2026-11-09", "2026-11-16", "2026-11-23",
    ]);
    expect(inspectSampleEditorialCalendar([{
      ...SAMPLE_EDITORIAL_CALENDAR[0],
      proposedDate: "2026-02-30",
    }])).toEqual(expect.arrayContaining([expect.stringMatching(/Invalid sample date/)]));
  });

  it("rejects missing campaigns, mismatched surfaces, and duplicate placement", () => {
    const slot = SAMPLE_EDITORIAL_CALENDAR[0];
    expect(inspectSampleEditorialCalendar([{ ...slot, campaignId: "unknown-campaign" }]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/Unknown campaign/)]));
    expect(inspectSampleEditorialCalendar([{ ...slot, surface: "nurture-copy-draft" }]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/Unsupported content surface/)]));
    expect(inspectSampleEditorialCalendar([slot, { ...slot, id: "sample-copy" }]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/Duplicate sample placement/)]));
  });

  it("rejects nonsynthetic IDs and duplicate IDs", () => {
    const slot = SAMPLE_EDITORIAL_CALENDAR[0];
    expect(inspectSampleEditorialCalendar([{ ...slot, id: "person@example.com" }]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/Invalid sample slot identity/)]));
    expect(inspectSampleEditorialCalendar([slot, slot]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/Duplicate slot ID/)]));
  });

  it("models only internal review checkpoints, never a publication approval", () => {
    expect(SAMPLE_REVIEW_CHECKPOINTS).toEqual([
      "COPY_DRAFT", "NEEDS_INTERNAL_REVIEW", "NEEDS_OWNER_REVIEW",
    ]);
    expect(REVIEW_CHECKPOINT_LABELS.NEEDS_OWNER_REVIEW).toBe("Needs owner review");
    expect(SAMPLE_REVIEW_CHECKPOINTS).not.toContain("PUBLISHED");
    expect(SAMPLE_REVIEW_CHECKPOINTS).not.toContain("APPROVED");
  });

  it("requires sequential draft review steps without mutating its input", () => {
    const original = SAMPLE_EDITORIAL_CALENDAR[0];
    const copyReview = simulateEditorialReviewProgress(original, "NEEDS_INTERNAL_REVIEW");
    const ownerReview = simulateEditorialReviewProgress(copyReview, "NEEDS_OWNER_REVIEW");
    expect(original.checkpoint).toBe("COPY_DRAFT");
    expect(copyReview.checkpoint).toBe("NEEDS_INTERNAL_REVIEW");
    expect(ownerReview.checkpoint).toBe("NEEDS_OWNER_REVIEW");
    expect(() => simulateEditorialReviewProgress(original, "NEEDS_OWNER_REVIEW")).toThrow(
      /next planning checkpoint/,
    );
    expect(() => simulateEditorialReviewProgress(ownerReview, "COPY_DRAFT")).toThrow(
      /next planning checkpoint/,
    );
  });

  it("preserves the existing production 404 guard and no-index metadata", () => {
    const page = read("src/app/mr10-campaign-preview/page.tsx");
    expect(page).toContain('process.env.NODE_ENV !== "development"');
    expect(page).toContain("notFound()");
    expect(page).toContain('dynamic = "force-dynamic"');
    expect(page).toContain("index: false");
    expect(page).toContain("follow: false");
    expect(page).toContain("SAMPLE_EDITORIAL_CALENDAR.map");
    expect(page).toContain("Sample only · never scheduled");
  });

  it("introduces no external dispatch, collection, persistence or schedule implementation", () => {
    for (const filename of [
      "src/components/marketing/editorial-calendar.ts",
      "src/app/mr10-campaign-preview/page.tsx",
    ]) {
      const source = read(filename);
      expect(source).not.toMatch(/\bfetch\s*\(|sendBeacon|localStorage|sessionStorage|document\.cookie|\.from\s*\(|supabase|cron|setInterval|setTimeout|\.schedule\s*\(|resend|stripe|<form\b/i);
    }
    expect(read("src/components/marketing/funnel.ts"))
      .toContain("No analytics, logging, transmission, cookies, or storage");
  });
});
