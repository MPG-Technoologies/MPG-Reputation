/**
 * MR-10B synthetic conversion-measurement model.
 *
 * This module is a PURE, offline simulator. It must not register listeners,
 * record actual page visits, send analytics, persist identifiers, or accept
 * untrusted user submissions. Production measurement remains gated.
 */
import { FunnelEvents } from "./funnel";

export const MEASUREMENT_STAGES = [
  "discovery",
  "education",
  "assessment",
  "trial-information",
] as const;

export type MeasurementStage = (typeof MEASUREMENT_STAGES)[number];

export const MEASUREMENT_CONTRACT = [
  {
    stage: "discovery",
    exampleEvent: FunnelEvents.pageView,
    definition: "A synthetic journey has encountered the product website.",
  },
  {
    stage: "education",
    exampleEvent: FunnelEvents.featuresViewed,
    definition: "A synthetic journey has explored the product features.",
  },
  {
    stage: "assessment",
    exampleEvent: FunnelEvents.checkCompleted,
    definition: "A synthetic journey has completed a private assessment.",
  },
  {
    stage: "trial-information",
    exampleEvent: FunnelEvents.trialDialogOpened,
    definition: "A synthetic journey opened trial information; no interest is registered.",
  },
] as const satisfies ReadonlyArray<{
  stage: MeasurementStage;
  exampleEvent: string;
  definition: string;
}>;

export interface SyntheticJourney {
  /** Synthetic fixture identifier only. Not a browser, user or device ID. */
  id: string;
  /** Ordered, nonrepeating stages that this synthetic journey reached. */
  stages: readonly MeasurementStage[];
}

export interface SyntheticStageResult {
  stage: MeasurementStage;
  count: number;
  /** Null means there is no valid denominator; it does NOT mean 0%. */
  fromPreviousRate: number | null;
  fromDiscoveryRate: number | null;
}

export interface SyntheticFunnelReport {
  mode: "synthetic-only";
  syntheticJourneyCount: number;
  stages: SyntheticStageResult[];
}

/** Offline numerical model only. DO NOT pass live visitor records here. */
export function summarizeSyntheticFunnel(
  journeys: readonly SyntheticJourney[],
): SyntheticFunnelReport {
  const seenIds = new Set<string>();
  const counts = MEASUREMENT_STAGES.map(() => 0);

  for (const journey of journeys) {
    if (!/^synthetic-[a-z0-9-]{1,48}$/.test(journey.id)) {
      throw new Error("Only explicit synthetic fixture identifiers are allowed.");
    }
    if (seenIds.has(journey.id)) {
      throw new Error("Duplicate synthetic journey identifiers are not allowed.");
    }
    seenIds.add(journey.id);

    let lastIndex = -1;
    for (const stage of journey.stages) {
      const index = MEASUREMENT_STAGES.indexOf(stage);
      if (index < 0 || index !== lastIndex + 1) {
        throw new Error("Synthetic stages must be ordered, contiguous, and unique.");
      }
      counts[index] += 1;
      lastIndex = index;
    }
  }

  const discoveryCount = counts[0];
  const stages = MEASUREMENT_STAGES.map((stage, index) => {
    const previous = index === 0 ? journeys.length : counts[index - 1];
    return {
      stage,
      count: counts[index],
      fromPreviousRate: previous > 0 ? counts[index] / previous : null,
      fromDiscoveryRate: discoveryCount > 0 ? counts[index] / discoveryCount : null,
    };
  });

  return {
    mode: "synthetic-only",
    syntheticJourneyCount: journeys.length,
    stages,
  };
}

/** Deterministic fake cohort for design and test assertions, never analytics. */
export const SYNTHETIC_FUNNEL_FIXTURE: readonly SyntheticJourney[] = [
  {
    id: "synthetic-one",
    stages: ["discovery", "education", "assessment", "trial-information"],
  },
  {
    id: "synthetic-two",
    stages: ["discovery", "education", "assessment"],
  },
  {
    id: "synthetic-three",
    stages: ["discovery", "education"],
  },
  {
    id: "synthetic-four",
    stages: ["discovery"],
  },
];
