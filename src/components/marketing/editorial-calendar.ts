/**
 * MR-10D static editorial calendar samples. No jobs, timers, publication
 * providers, persistence, real audience data or owner-approval authority.
 */
import {
  CAMPAIGN_BRIEFS,
  type CampaignContentSurface,
} from "./campaign-briefs";

export const SAMPLE_REVIEW_CHECKPOINTS = [
  "COPY_DRAFT",
  "NEEDS_INTERNAL_REVIEW",
  "NEEDS_OWNER_REVIEW",
] as const;
export type SampleReviewCheckpoint =
  (typeof SAMPLE_REVIEW_CHECKPOINTS)[number];

export const REVIEW_CHECKPOINT_LABELS: Record<SampleReviewCheckpoint, string> = {
  COPY_DRAFT: "Copy draft",
  NEEDS_INTERNAL_REVIEW: "Needs internal review",
  NEEDS_OWNER_REVIEW: "Needs owner review",
};

export interface SampleEditorialSlot {
  id: string;
  mode: "SAMPLE_ONLY";
  campaignId: string;
  /** Date for editorial illustration, NOT an executable schedule. */
  proposedDate: string;
  surface: CampaignContentSurface;
  checkpoint: SampleReviewCheckpoint;
}

export const SAMPLE_EDITORIAL_CALENDAR: readonly SampleEditorialSlot[] = [
  {
    id: "sample-followup-week",
    mode: "SAMPLE_ONLY",
    campaignId: "consistent-followup",
    proposedDate: "2026-11-09",
    surface: "social-copy-draft",
    checkpoint: "COPY_DRAFT",
  },
  {
    id: "sample-measurement-week",
    mode: "SAMPLE_ONLY",
    campaignId: "responsible-measurement",
    proposedDate: "2026-11-16",
    surface: "website-education",
    checkpoint: "NEEDS_INTERNAL_REVIEW",
  },
  {
    id: "sample-process-check-week",
    mode: "SAMPLE_ONLY",
    campaignId: "private-process-check",
    proposedDate: "2026-11-23",
    surface: "social-copy-draft",
    checkpoint: "NEEDS_OWNER_REVIEW",
  },
];

/** Validate developer-authored examples; this is not an approval mechanism. */
export function inspectSampleEditorialCalendar(
  slots: readonly SampleEditorialSlot[] = SAMPLE_EDITORIAL_CALENDAR,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const placements = new Set<string>();

  for (const slot of slots) {
    if (slot.mode !== "SAMPLE_ONLY" || !/^sample-[a-z0-9-]{1,48}$/.test(slot.id)) {
      errors.push(`Invalid sample slot identity: ${slot.id}`);
    }
    if (ids.has(slot.id)) errors.push(`Duplicate slot ID: ${slot.id}`);
    ids.add(slot.id);

    const brief = CAMPAIGN_BRIEFS.find((candidate) => candidate.id === slot.campaignId);
    if (!brief) errors.push(`Unknown campaign: ${slot.campaignId}`);
    else if (!brief.surfaces.includes(slot.surface)) {
      errors.push(`Unsupported content surface: ${slot.id}`);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.proposedDate)
      || Number.isNaN(Date.parse(slot.proposedDate))
      || new Date(`${slot.proposedDate}T00:00:00Z`).toISOString().slice(0, 10) !== slot.proposedDate) {
      errors.push(`Invalid sample date: ${slot.id}`);
    }

    if (!(SAMPLE_REVIEW_CHECKPOINTS as readonly string[]).includes(slot.checkpoint)) {
      errors.push(`Invalid review checkpoint: ${slot.id}`);
    }

    const placement = [slot.proposedDate, slot.surface, slot.campaignId].join(":");
    if (placements.has(placement)) errors.push(`Duplicate sample placement: ${slot.id}`);
    placements.add(placement);
  }

  return errors;
}

/**
 * Returns a NEW sample; never persists a status or approves publication.
 * The terminal state still requires external, explicit owner review.
 */
export function simulateEditorialReviewProgress(
  slot: SampleEditorialSlot,
  next: SampleReviewCheckpoint,
): SampleEditorialSlot {
  const allowed: Readonly<Record<SampleReviewCheckpoint, SampleReviewCheckpoint | null>> = {
    COPY_DRAFT: "NEEDS_INTERNAL_REVIEW",
    NEEDS_INTERNAL_REVIEW: "NEEDS_OWNER_REVIEW",
    NEEDS_OWNER_REVIEW: null,
  };
  if (slot.mode !== "SAMPLE_ONLY" || allowed[slot.checkpoint] !== next) {
    throw new Error("Sample review progression requires the next planning checkpoint.");
  }
  return { ...slot, checkpoint: next };
}
