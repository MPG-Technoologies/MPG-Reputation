import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PUBLICATION_REVIEW_GATES,
  buildPublicationReviewPacket,
  countPreparedReviewEvidence,
  type EvidencePrepGateId,
} from "../../src/components/marketing/publication-readiness";
import { CAMPAIGN_BRIEFS } from "../../src/components/marketing/campaign-briefs";

describe("MR-10E draft-only publication readiness", () => {
  it("defines seven unique editorial, compliance and owner decision gates", () => {
    const ids = PUBLICATION_REVIEW_GATES.map((g) => g.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("claims-and-evidence");
    expect(ids).toContain("review-integrity");
    expect(ids).toContain("privacy-and-legal");
    expect(ids).toContain("consent-and-suppression");
    expect(ids).toContain("owner-publication-decision");
  });

  it("prepares packets only for the existing static draft campaigns", () => {
    for (const brief of CAMPAIGN_BRIEFS) {
      const packet = buildPublicationReviewPacket(brief.id);
      expect(packet.mode).toBe("PRELAUNCH_REVIEW_ONLY");
      expect(packet.campaignStatus).toBe("DRAFT_ONLY");
      expect(packet.campaignId).toBe(brief.id);
      expect(packet.reviewItems).toHaveLength(PUBLICATION_REVIEW_GATES.length);
      expect(packet.canPublish).toBe(false);
      expect(packet.ownerReleaseAuthorized).toBe(false);
    }
    expect(() => buildPublicationReviewPacket("unknown")).toThrow(/valid, existing draft/);
  });

  it("counts prepared evidence without treating it as approval", () => {
    const packet = buildPublicationReviewPacket("consistent-followup", [
      "claims-and-evidence",
      "review-integrity",
    ]);
    expect(countPreparedReviewEvidence(packet)).toBe(2);
    expect(packet.reviewItems.find((g) => g.id === "claims-and-evidence")?.status)
      .toBe("EVIDENCE_DRAFTED");
    expect(packet.reviewItems.find((g) => g.id === "privacy-and-legal")?.status)
      .toBe("NOT_ASSESSED");
    expect(packet.canPublish).toBe(false);
  });

  it("never records an owner release decision, even when all other evidence is prepared", () => {
    const allPreparatoryGates = PUBLICATION_REVIEW_GATES
      .filter((g) => g.id !== "owner-publication-decision")
      .map((g) => g.id as EvidencePrepGateId);
    const packet = buildPublicationReviewPacket("responsible-measurement", allPreparatoryGates);
    expect(countPreparedReviewEvidence(packet)).toBe(6);
    expect(packet.reviewItems.find((g) => g.id === "owner-publication-decision")?.status)
      .toBe("EXTERNAL_OWNER_DECISION_REQUIRED");
    expect(packet.canPublish).toBe(false);
    expect(packet.ownerReleaseAuthorized).toBe(false);
  });

  it("rejects attempts to mark the owner decision as evidence prepared", () => {
    expect(() => buildPublicationReviewPacket("consistent-followup", [
      "owner-publication-decision" as EvidencePrepGateId,
    ])).toThrow(/owner-restricted evidence gate/);
  });

  it("rejects unknown and repeated evidence gate entries", () => {
    expect(() => buildPublicationReviewPacket("private-process-check", [
      "unexpected" as EvidencePrepGateId,
    ])).toThrow(/Invalid, repeated/);
    expect(() => buildPublicationReviewPacket("private-process-check", [
      "review-integrity",
      "review-integrity",
    ])).toThrow(/Invalid, repeated/);
  });

  it("does not mutate the user-supplied simulated evidence list", () => {
    const simulated: EvidencePrepGateId[] = ["claims-and-evidence"];
    buildPublicationReviewPacket("consistent-followup", simulated);
    expect(simulated).toEqual(["claims-and-evidence"]);
  });

  it("includes no publishing, network, persistence or scheduling adapter", () => {
    const root = path.resolve(__dirname, "../..");
    const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
    const source = read("src/components/marketing/publication-readiness.ts");
    expect(source).not.toMatch(/\bfetch\s*\(|sendBeacon|localStorage|sessionStorage|document\.cookie|supabase|stripe|resend|inngest|setInterval|setTimeout|\.schedule\s*\(|<form\b/i);
    expect(source).toContain("canPublish: false");
    expect(source).toContain("ownerReleaseAuthorized: false");
    expect(read("src/components/marketing/funnel.ts"))
      .toContain("No analytics, logging, transmission, cookies, or storage");
  });
});
