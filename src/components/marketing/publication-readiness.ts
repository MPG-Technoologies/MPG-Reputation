/**
 * MR-10E: pure, draft-only publication readiness checklist.
 *
 * This module prepares an editorial REVIEW PACKET. It neither grants approval
 * nor publishes, sends, tracks, stores or schedules a campaign.
 */
import {
  CAMPAIGN_BRIEFS,
  auditDraftCampaigns,
} from "./campaign-briefs";

export const PUBLICATION_REVIEW_GATES = [
  {
    id: "claims-and-evidence",
    title: "Product claims and evidence",
    requirement: "Check every statement against implemented, verified MPG Reputation functionality.",
  },
  {
    id: "review-integrity",
    title: "Neutral review-request integrity",
    requirement: "Avoid review gating, incentives for positive reviews and claims that requests guarantee published reviews.",
  },
  {
    id: "privacy-and-legal",
    title: "Privacy, data and legal review",
    requirement: "Qualified review of intended geography, data processing, disclosures and any future measurement.",
  },
  {
    id: "consent-and-suppression",
    title: "Consent, preferences and unsubscribe",
    requirement: "Externally verify any future messaging consent, suppression and opt-out requirements before a live campaign.",
  },
  {
    id: "provider-and-channel",
    title: "Provider and channel readiness",
    requirement: "Verify proposed advertising, email or social channels, account access and provider obligations separately.",
  },
  {
    id: "commercial-and-trial",
    title: "Commercial and trial authorization",
    requirement: "Confirm owner-approved offer wording; 30 Free Review Requests is not 30 published reviews.",
  },
  {
    id: "owner-publication-decision",
    title: "Explicit owner publication decision",
    requirement: "No campaign or public release proceeds without a separate, recorded owner decision.",
  },
] as const;

export type PublicationReviewGateId =
  (typeof PUBLICATION_REVIEW_GATES)[number]["id"];

export type EvidencePrepGateId =
  Exclude<PublicationReviewGateId, "owner-publication-decision">;

export type PublicationReviewStatus =
  | "NOT_ASSESSED"
  | "EVIDENCE_DRAFTED"
  | "EXTERNAL_OWNER_DECISION_REQUIRED";

export interface PublicationReviewItem {
  id: PublicationReviewGateId;
  title: string;
  requirement: string;
  status: PublicationReviewStatus;
}

export interface PublicationReviewPacket {
  mode: "PRELAUNCH_REVIEW_ONLY";
  campaignId: string;
  campaignStatus: "DRAFT_ONLY";
  reviewItems: readonly PublicationReviewItem[];
  /** Always false. Evidence preparation never authorizes publication. */
  canPublish: false;
  /** An external owner decision is required and never set by this model. */
  ownerReleaseAuthorized: false;
}

/**
 * Produce an in-memory evidence-preparation summary from an existing draft.
 * EVIDENCE_DRAFTED means material is ready for a human to inspect, not approved.
 */
export function buildPublicationReviewPacket(
  campaignId: string,
  evidenceDrafted: readonly EvidencePrepGateId[] = [],
): PublicationReviewPacket {
  const brief = CAMPAIGN_BRIEFS.find((entry) => entry.id === campaignId);
  if (!brief || auditDraftCampaigns([brief]).length !== 0) {
    throw new Error("Publication review requires a valid, existing draft campaign.");
  }

  const known = new Set<PublicationReviewGateId>(
    PUBLICATION_REVIEW_GATES.map((gate) => gate.id),
  );
  const prepared = new Set<PublicationReviewGateId>();
  for (const id of evidenceDrafted) {
    if (!known.has(id) || id === "owner-publication-decision" || prepared.has(id)) {
      throw new Error("Invalid, repeated or owner-restricted evidence gate.");
    }
    prepared.add(id);
  }

  return {
    mode: "PRELAUNCH_REVIEW_ONLY",
    campaignId: brief.id,
    campaignStatus: "DRAFT_ONLY",
    reviewItems: PUBLICATION_REVIEW_GATES.map((gate) => ({
      id: gate.id,
      title: gate.title,
      requirement: gate.requirement,
      status: gate.id === "owner-publication-decision"
        ? "EXTERNAL_OWNER_DECISION_REQUIRED"
        : prepared.has(gate.id) ? "EVIDENCE_DRAFTED" : "NOT_ASSESSED",
    })),
    canPublish: false,
    ownerReleaseAuthorized: false,
  };
}

export function countPreparedReviewEvidence(packet: PublicationReviewPacket): number {
  return packet.reviewItems.filter((item) => item.status === "EVIDENCE_DRAFTED").length;
}
