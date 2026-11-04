import {
  MONTHLY_JOB_OPTIONS,
  REQUEST_PROCESS_OPTIONS,
  type ReputationCheckInput,
  type ReputationReport,
  type ReportItem,
  type ReportSection,
} from "./reputation-contracts";

/**
 * Deterministic Reputation Opportunity Report generator.
 *
 * Rules of honesty baked in here:
 * - No proprietary "Reputation Score".
 * - Numbers shown are derived ONLY from what the business stated,
 *   and are labelled as customer-provided estimates.
 * - Missing data is surfaced as a limitation, never guessed.
 */

const PROCESS_BAND: Record<
  ReputationCheckInput["requestProcess"],
  ReputationReport["consistencyBand"]
> = {
  no: "not_present",
  sometimes: "ad_hoc",
  yes_manual: "manual_consistent",
  yes_automated: "automated",
};

const PROCESS_LABEL: Record<string, string> = Object.fromEntries(
  REQUEST_PROCESS_OPTIONS.map((o) => [o.value, o.label]),
);

const BAND_SUMMARY: Record<ReputationReport["consistencyBand"], string> = {
  not_present:
    "No review-request process is currently in place. Every review the business receives today is arriving without a systematic request behind it.",
  ad_hoc:
    "Review requests happen, but depend on someone remembering. Consistency — not willingness — is the limiting factor in this kind of process.",
  manual_consistent:
    "Requests are being sent manually after each job. The discipline is there; the cost is ongoing staff time, and the risk is that busy periods quietly break the habit.",
  automated:
    "An automated request process is already in place. The opportunity shifts from consistency to visibility: coverage, timing, deliverability and exception handling.",
};

export function buildReport(input: ReputationCheckInput): ReputationReport {
  const band = PROCESS_BAND[input.requestProcess];
  const jobOption = MONTHLY_JOB_OPTIONS.find(
    (o) => o.value === input.monthlyJobs,
  );
  const monthlyMidpoint = jobOption?.midpoint ?? null;

  const sections: ReportSection[] = [];

  // ---- 1. Current snapshot ----
  const snapshot: ReportItem[] = [];
  if (input.googleRating != null && input.reviewCount != null) {
    snapshot.push({
      kind: "provided",
      text: `Stated Google profile: ${input.googleRating.toFixed(1)}★ across approximately ${input.reviewCount} reviews (as provided by you — not independently verified in this staging check).`,
    });
  } else if (input.reviewCount != null) {
    snapshot.push({
      kind: "provided",
      text: `Stated review count: approximately ${input.reviewCount} reviews (rating not provided).`,
    });
  } else {
    snapshot.push({
      kind: "gap",
      text: "No review profile figures were provided, so your current public reputation baseline is unknown to this report.",
    });
  }
  if (monthlyMidpoint != null) {
    snapshot.push({
      kind: "provided",
      text: `Stated volume: roughly ${jobOption?.label.toLowerCase()} completed jobs or appointments per month.`,
    });
  }
  snapshot.push({
    kind: "observed",
    text: `Stated request process: “${PROCESS_LABEL[input.requestProcess]}”.`,
  });
  snapshot.push({
    kind: "observed",
    text: `Business profile: ${input.businessCategory} · ${
      input.locations === "multi" ? "multiple locations" : "one location"
    }.`,
  });
  sections.push({ id: "snapshot", title: "Current Snapshot", items: snapshot });

  // ---- 2. Review request process ----
  const followUpText: Record<string, string> = {
    never:
      "Stated follow-up practice: none. A single unanswered request is the end of the line — and ignored requests are the norm, not the exception.",
    sometimes:
      "Stated follow-up practice: occasional, when time allows. Follow-up consistency therefore inherits the same memory-dependence as the initial request.",
    always:
      "Stated follow-up practice: every request is followed up. That discipline is rare — the open question is how much staff time it consumes.",
  };
  const trackingText: Record<string, string> = {
    none: "Stated activity tracking: none. There is no way to answer “who was asked, and when” — which makes consistency impossible to even measure.",
    scattered:
      "Stated activity tracking: scattered across inboxes, notes and memory. Partial records are often harder to trust than none at all.",
    centralized:
      "Stated activity tracking: centralized. You can already answer “who was asked, and when” — the strongest foundation a process can have.",
  };
  sections.push({
    id: "process",
    title: "Review Request Process",
    items: [
      { kind: "observed", text: BAND_SUMMARY[band] },
      { kind: "observed", text: followUpText[input.followUp] },
      { kind: "observed", text: trackingText[input.tracking] },
      ...(input.gaps.length > 0
        ? input.gaps.map((g) => ({
            kind: "gap" as const,
            text: `You flagged: “${g}”.`,
          }))
        : [
            {
              kind: "observed" as const,
              text: "No specific workflow gaps were flagged. The consistency questions below are still worth a candid internal review.",
            },
          ]),
    ],
  });

  // ---- 3. Consistency gap ----
  const consistency: ReportItem[] = [];
  if (monthlyMidpoint != null) {
    if (band === "not_present") {
      consistency.push({
        kind: "observed",
        text: `Based on your stated volume, roughly ${monthlyMidpoint} completed customer interactions per month currently end without any systematic review request. That is an estimate derived from your answer, not a measurement.`,
      });
    } else if (band === "ad_hoc") {
      consistency.push({
        kind: "observed",
        text: `With ~${monthlyMidpoint} completed jobs per month (your estimate), an ad-hoc process means an unknown share of customers are never asked. The gap is invisible precisely because nothing is tracked.`,
      });
    } else if (band === "manual_consistent") {
      consistency.push({
        kind: "observed",
        text: `At ~${monthlyMidpoint} jobs per month (your estimate), a manual process means ~${monthlyMidpoint} individual moments of staff effort every month — each one a chance for delay, inconsistency, or a missed request during busy periods.`,
      });
    } else {
      consistency.push({
        kind: "observed",
        text: "With automation in place, the consistency gap is likely small. Remaining questions: are exceptions visible, and are opted-out or unreachable customers handled cleanly?",
      });
    }
  } else {
    consistency.push({
      kind: "gap",
      text: "Monthly customer volume was not provided, so the size of your consistency gap cannot be estimated.",
    });
  }
  sections.push({
    id: "consistency",
    title: "Consistency Gap",
    items: consistency,
  });

  // ---- 4. Workflow opportunities ----
  const opportunities: ReportItem[] = [];
  if (band === "not_present" || band === "ad_hoc") {
    opportunities.push(
      {
        kind: "action",
        text: "Tie the review request to the moment a job is marked complete — not to someone's memory.",
      },
      {
        kind: "action",
        text: "Give every customer one clear, neutral request with a single path to your review destination.",
      },
      {
        kind: "action",
        text: "Keep a record of who was asked and when, so follow-up and suppression rules are enforceable.",
      },
    );
  } else if (band === "manual_consistent") {
    opportunities.push(
      {
        kind: "action",
        text: "Automate the send itself while keeping your existing rules for timing and eligibility.",
      },
      {
        kind: "action",
        text: "Free staff time from routine sending so exceptions — failures, bad destinations, opt-outs — get the attention instead.",
      },
    );
  } else {
    opportunities.push(
      {
        kind: "action",
        text: "Review your automation's exception handling: failed sends, invalid review links, and suppression lists.",
      },
      {
        kind: "action",
        text: "Confirm your requests are neutral in wording and identical for every customer, regardless of expected sentiment.",
      },
    );
  }
  sections.push({
    id: "opportunities",
    title: "Workflow Opportunities",
    items: opportunities,
  });

  // ---- 5. Automation fit ----
  const fit: ReportItem[] = [];
  if (input.software === "None / paper & spreadsheets") {
    fit.push({
      kind: "observed",
      text: "You indicated no customer-management software. MPG Reputation's Quick Complete flow is designed for exactly this: mark a job complete in seconds, no integration required.",
    });
  } else {
    fit.push({
      kind: "observed",
      text: `You indicated you use ${input.software}. A universal completion signal (API / webhook) is the intended path for tools like this — native integrations are evaluated on evidence of demand, not assumed.`,
    });
  }
  fit.push({
    kind: "observed",
    text:
      band === "automated"
        ? "Automation fit: you already automate. MPG Reputation would need to prove stronger visibility and simpler operation than your current setup."
        : "Automation fit: high. Your stated answers describe a process that is routine, repetitive, and rule-based — the profile automation handles best.",
  });
  if (input.locations === "multi") {
    fit.push({
      kind: "observed",
      text: "Multi-location note: MPG Reputation's verified architecture scopes customers, destinations, requests and usage per location under one organization — a fit for operators running more than one site.",
    });
  }
  if (input.followUp !== "always") {
    fit.push({
      kind: "observed",
      text: "Bounded follow-up: the platform's trial system supports limited, rule-based reminders rather than unlimited chasing — follow-up without hounding.",
    });
  }
  sections.push({ id: "fit", title: "Potential Automation Fit", items: fit });

  // ---- 6. Data limitations ----
  const limitations: ReportItem[] = [
    {
      kind: "gap",
      text: "This staging report uses only the information you provided. Public review data was not independently retrieved or verified.",
    },
  ];
  if (input.googleRating == null)
    limitations.push({
      kind: "gap",
      text: "Google rating was not provided — public reputation baseline incomplete.",
    });
  if (input.reviewCount == null)
    limitations.push({
      kind: "gap",
      text: "Review count was not provided — public reputation baseline incomplete.",
    });
  if (monthlyMidpoint == null)
    limitations.push({
      kind: "gap",
      text: "Job volume was not provided — opportunity size could not be estimated.",
    });
  limitations.push({
    kind: "observed",
    text: "No benchmark figures are shown: MPG Reputation does not publish industry averages it cannot evidence.",
  });
  sections.push({
    id: "limitations",
    title: "Data Limitations",
    items: limitations,
  });

  // ---- 7. Recommended next steps ----
  sections.push({
    id: "next",
    title: "Recommended Next Steps",
    items: [
      {
        kind: "action",
        text: "Write down your current request process end-to-end. If it contains the words “someone remembers”, that is the gap to close first.",
      },
      {
        kind: "action",
        text: "Confirm your review destination link (e.g. your Google review link) is current and shared with everyone who talks to customers.",
      },
      {
        kind: "action",
        text: "When the MPG Reputation pilot opens, the “30 Free Review Requests” trial concept is designed to test exactly this: whether a consistent request process changes your review inflow. Availability is not yet public.",
      },
    ],
  });

  return {
    businessName: input.businessName,
    generatedAt: new Date().toISOString(),
    estimatedMonthlyOpportunities: monthlyMidpoint,
    consistencyBand: band,
    sections,
  };
}
