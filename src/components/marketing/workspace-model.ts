/**
 * MR-10F: composition of existing static campaign, calendar, and review data.
 * This is an in-memory preview snapshot, never a saved or approved campaign.
 */
import {
  auditDraftCampaigns,
  getCampaignBrief,
  type CampaignBrief,
} from "./campaign-briefs";
import {
  inspectSampleEditorialCalendar,
  SAMPLE_EDITORIAL_CALENDAR,
  type SampleEditorialSlot,
} from "./editorial-calendar";
import {
  buildPublicationReviewPacket,
  type EvidencePrepGateId,
  type PublicationReviewPacket,
} from "./publication-readiness";

export interface MarketingWorkspaceSnapshot {
  mode: "LOCAL_SIMULATION_ONLY";
  campaign: CampaignBrief;
  placements: readonly SampleEditorialSlot[];
  review: PublicationReviewPacket;
  canPublish: false;
}

/**
 * Invalid draft references fail closed. Optional "prepared" flags describe
 * unsaved demo evidence only; they cannot move the owner-decision gate.
 */
export function buildMarketingWorkspaceSnapshot(
  campaignId: string,
  preparedEvidence: readonly EvidencePrepGateId[] = [],
): MarketingWorkspaceSnapshot {
  const campaign = getCampaignBrief(campaignId);
  if (
    !campaign ||
    campaign.status !== "DRAFT_ONLY" ||
    auditDraftCampaigns([campaign]).length > 0
  ) {
    throw new Error("Workspace requires a valid existing draft campaign.");
  }

  const placements = SAMPLE_EDITORIAL_CALENDAR.filter(
    (slot) => slot.campaignId === campaign.id,
  );
  if (
    placements.length === 0 ||
    inspectSampleEditorialCalendar(placements).length > 0
  ) {
    throw new Error("Workspace requires valid example calendar placements.");
  }

  return {
    mode: "LOCAL_SIMULATION_ONLY",
    campaign,
    placements,
    review: buildPublicationReviewPacket(campaign.id, preparedEvidence),
    canPublish: false,
  };
}
