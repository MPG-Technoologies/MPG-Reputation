import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CAMPAIGN_BRIEFS } from "../../src/components/marketing/campaign-briefs";
import { SAMPLE_EDITORIAL_CALENDAR } from "../../src/components/marketing/editorial-calendar";
import {
  PUBLICATION_REVIEW_GATES,
  countPreparedReviewEvidence,
  type EvidencePrepGateId,
} from "../../src/components/marketing/publication-readiness";
import { buildMarketingWorkspaceSnapshot } from "../../src/components/marketing/workspace-model";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("MR-10F integrated prelaunch marketing workspace", () => {
  it("connects each existing campaign brief to its own sample placements", () => {
    for (const brief of CAMPAIGN_BRIEFS) {
      const snapshot = buildMarketingWorkspaceSnapshot(brief.id);
      expect(snapshot.mode).toBe("LOCAL_SIMULATION_ONLY");
      expect(snapshot.campaign.id).toBe(brief.id);
      expect(snapshot.campaign.status).toBe("DRAFT_ONLY");
      expect(snapshot.placements.length).toBeGreaterThan(0);
      expect(snapshot.placements.every((slot) => slot.campaignId === brief.id)).toBe(true);
      expect(snapshot.placements.every((slot) => slot.mode === "SAMPLE_ONLY")).toBe(true);
      expect(snapshot.review.campaignId).toBe(brief.id);
      expect(snapshot.review.reviewItems).toHaveLength(PUBLICATION_REVIEW_GATES.length);
    }
    expect(SAMPLE_EDITORIAL_CALENDAR).toHaveLength(3);
  });

  it("rejects unknown draft identifiers instead of inventing campaigns", () => {
    expect(() => buildMarketingWorkspaceSnapshot("unknown-campaign")).toThrow(
      /valid existing draft campaign/,
    );
  });

  it("keeps all publication, release, and owner approval flags false", () => {
    const allEvidence = PUBLICATION_REVIEW_GATES
      .filter((gate) => gate.id !== "owner-publication-decision")
      .map((gate) => gate.id as EvidencePrepGateId);
    const snapshot = buildMarketingWorkspaceSnapshot("consistent-followup", allEvidence);
    expect(countPreparedReviewEvidence(snapshot.review)).toBe(6);
    expect(snapshot.canPublish).toBe(false);
    expect(snapshot.review.canPublish).toBe(false);
    expect(snapshot.review.ownerReleaseAuthorized).toBe(false);
    expect(snapshot.review.reviewItems.find((g) => g.id === "owner-publication-decision")?.status)
      .toBe("EXTERNAL_OWNER_DECISION_REQUIRED");
  });

  it("blocks invalid or repeated evidence claims, including owner authorization", () => {
    expect(() => buildMarketingWorkspaceSnapshot("consistent-followup", [
      "owner-publication-decision" as EvidencePrepGateId,
    ])).toThrow(/owner-restricted/);
    expect(() => buildMarketingWorkspaceSnapshot("consistent-followup", [
      "review-integrity", "review-integrity",
    ])).toThrow(/repeated/);
  });

  it("does not carry simulated evidence across successive snapshots", () => {
    const withEvidence = buildMarketingWorkspaceSnapshot("consistent-followup", [
      "claims-and-evidence",
    ]);
    const differentDraft = buildMarketingWorkspaceSnapshot("private-process-check");
    const initialDraftAgain = buildMarketingWorkspaceSnapshot("consistent-followup");
    expect(countPreparedReviewEvidence(withEvidence.review)).toBe(1);
    expect(countPreparedReviewEvidence(differentDraft.review)).toBe(0);
    expect(countPreparedReviewEvidence(initialDraftAgain.review)).toBe(0);
  });

  it("preserves the existing Next.js production 404 guard and robots exclusion", () => {
    const page = read("src/app/mr10-campaign-preview/page.tsx");
    expect(page).toContain('process.env.NODE_ENV !== "development"');
    expect(page).toContain("notFound()");
    expect(page).toContain('dynamic = "force-dynamic"');
    expect(page).toContain("index: false");
    expect(page).toContain("follow: false");
    expect(page).toContain("nocache: true");
    expect(page).toContain("<CampaignWorkspace />");
    expect(page).toContain("CAMPAIGN_BRIEFS.map");
    expect(page).toContain("SAMPLE_EDITORIAL_CALENDAR.map");
  });

  it("offers campaign selection and accessible in-memory evidence toggles, not approvals", () => {
    const client = read("src/components/marketing/CampaignWorkspace.tsx");
    expect(client).toMatch(/^"use client";/);
    expect(client).toContain("useState(");
    expect(client).toContain("aria-pressed=");
    expect(client).toContain('type="button"');
    expect(client).toContain('type="checkbox"');
    expect(client).toContain("setPreparedEvidence([])");
    expect(client).toContain('role="status"');
    expect(client).toContain("Locked · Separate owner publication decision required");
    expect(client).toContain("Publication blocked");
    expect(client).toContain("focus-visible:outline");
  });

  it("adds no network, storage, dispatch, timers, or real approval/publishing actions", () => {
    for (const file of [
      "src/components/marketing/workspace-model.ts",
      "src/components/marketing/CampaignWorkspace.tsx",
      "src/app/mr10-campaign-preview/page.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/\bfetch\s*\(|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|WebSocket|EventSource|supabase|resend|stripe|inngest|setInterval|setTimeout|\.schedule\s*\(|<form\b/i);
    }
    expect(read("src/components/marketing/funnel.ts"))
      .toContain("No analytics, logging, transmission, cookies, or storage");
  });
});
