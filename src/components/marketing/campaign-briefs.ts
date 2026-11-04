/**
 * MR-10C prelaunch campaign planning. STATIC DRAFTS ONLY.
 * No publishing, sending, analytics, lead capture, database, or provider adapters.
 */
import type { MeasurementStage } from "./measurement-model";

export const CAMPAIGN_PREVIEW_LINKS = [
  "/features",
  "/how-it-works",
  "/reputation-check",
  "/resources/a-repeatable-review-request-workflow",
  "/resources/understanding-review-request-activity",
] as const;

export type CampaignPreviewLink = (typeof CAMPAIGN_PREVIEW_LINKS)[number];
export type CampaignContentSurface =
  | "website-education"
  | "social-copy-draft"
  | "nurture-copy-draft";

export interface CampaignBrief {
  id: string;
  status: "DRAFT_ONLY";
  audience: string;
  objective: string;
  stage: MeasurementStage;
  surfaces: readonly CampaignContentSurface[];
  creative: {
    eyebrow: string;
    headline: string;
    explanation: string;
    ctaLabel: string;
    ctaHref: CampaignPreviewLink;
  };
  reviewNotes: readonly string[];
}

/** Controlled, truthful example content; no real-client endorsement or promises. */
export const CAMPAIGN_BRIEFS: readonly CampaignBrief[] = [
  {
    id: "consistent-followup",
    status: "DRAFT_ONLY",
    audience: "Service-business owners managing completed customer work",
    objective: "Explain the existing completion-to-request workflow",
    stage: "education",
    surfaces: ["website-education", "social-copy-draft"],
    creative: {
      eyebrow: "Product education",
      headline: "Build review requests into your service routine",
      explanation:
        "Record completed services, apply neutral request eligibility rules, and understand where a follow-up stands. Live customer messaging is not enabled in this preview.",
      ctaLabel: "See how it works",
      ctaHref: "/how-it-works",
    },
    reviewNotes: [
      "Do not imply a review request was sent simply because a service was recorded.",
      "Validate eligibility and messaging-provider claims before publication.",
    ],
  },
  {
    id: "responsible-measurement",
    status: "DRAFT_ONLY",
    audience: "Business operators who want accurate review-request reporting",
    objective: "Teach the difference between request activity and published reviews",
    stage: "education",
    surfaces: ["website-education", "nurture-copy-draft"],
    creative: {
      eyebrow: "Responsible measurement",
      headline: "Understand what your review-request activity means",
      explanation:
        "A completed service, an eligible request and a tracked click are different outcomes. A click does not establish that Google published a review.",
      ctaLabel: "Read the measurement guide",
      ctaHref: "/resources/understanding-review-request-activity",
    },
    reviewNotes: [
      "Never present tracked clicks as published reviews.",
      "This copy is not approved for live email delivery.",
    ],
  },
  {
    id: "private-process-check",
    status: "DRAFT_ONLY",
    audience: "Businesses exploring their current request process",
    objective: "Introduce the local-only Free Reputation Check",
    stage: "assessment",
    surfaces: ["website-education", "social-copy-draft"],
    creative: {
      eyebrow: "Explore your workflow",
      headline: "Where does your review-request process need attention?",
      explanation:
        "Use the Free Reputation Check to reflect on your follow-up habits and explore a browser-only opportunity report. No business answers are submitted or stored.",
      ctaLabel: "Try the private check",
      ctaHref: "/reputation-check",
    },
    reviewNotes: [
      "The assessment is based on visitor-provided answers, not live Google review data.",
      "Do not imply this is a functioning lead-registration or trial-enrollment flow.",
    ],
  },
];

export function getCampaignBrief(id: string): CampaignBrief | undefined {
  return CAMPAIGN_BRIEFS.find((brief) => brief.id === id);
}

/** A review aid, NOT publication authorization. */
export function auditDraftCampaigns(
  briefs: readonly CampaignBrief[] = CAMPAIGN_BRIEFS,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const brief of briefs) {
    if (!/^[a-z][a-z0-9-]{1,48}$/.test(brief.id) || ids.has(brief.id)) {
      issues.push(`Invalid or duplicate campaign ID: ${brief.id}`);
    }
    ids.add(brief.id);
    if (brief.status !== "DRAFT_ONLY") {
      issues.push(`Campaign is not a draft: ${brief.id}`);
    }
    if (!CAMPAIGN_PREVIEW_LINKS.includes(brief.creative.ctaHref)) {
      issues.push(`Unapproved CTA destination: ${brief.id}`);
    }
    if (!brief.creative.headline.trim() || !brief.creative.explanation.trim()) {
      issues.push(`Missing educational copy: ${brief.id}`);
    }
    const copy = [
      brief.creative.headline,
      brief.creative.explanation,
      brief.creative.ctaLabel,
    ].join(" ");
    if (/30 Free Reviews\b|guaranteed? (?:five.star|positive|published) reviews?|automatic(?:ally)? publish(?:ed)? reviews?/i.test(copy)) {
      issues.push(`Unsupported promise in campaign copy: ${brief.id}`);
    }
  }

  return issues;
}
