"use client";

import {
  Eye,
  UserRound,
  AlertTriangle,
  Compass,
  FlaskConical,
} from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Reveal } from "@/components/marketing/site/Reveal";
import { ConversionNextSteps } from "@/components/marketing/site/ConversionNextSteps";
import type {
  ReputationReport,
  ReportItem,
} from "@/components/marketing/reputation-contracts";

const BAND_LABEL: Record<ReputationReport["consistencyBand"], string> = {
  not_present: "No systematic process",
  ad_hoc: "Ad-hoc / memory-dependent",
  manual_consistent: "Manual but consistent",
  automated: "Already automated",
};

/** Synthetic example shown at /reputation-report (no id). */
const EXAMPLE_REPORT: ReputationReport = {
  businessName: "Ridgeline Heating & Air (example)",
  generatedAt: "2026-11-04T12:00:00.000Z",
  estimatedMonthlyOpportunities: 50,
  consistencyBand: "ad_hoc",
  sections: [
    {
      id: "snapshot",
      title: "Current Snapshot",
      items: [
        {
          kind: "provided",
          text: "Stated Google profile: 4.6★ across approximately 87 reviews (as provided — not independently verified in this staging check).",
        },
        {
          kind: "provided",
          text: "Stated volume: roughly 25 – 75 completed jobs or appointments per month.",
        },
        {
          kind: "observed",
          text: "Stated request process: “Sometimes — when someone remembers”.",
        },
      ],
    },
    {
      id: "process",
      title: "Review Request Process",
      items: [
        {
          kind: "observed",
          text: "Review requests happen, but depend on someone remembering. Consistency — not willingness — is the limiting factor in this kind of process.",
        },
        {
          kind: "gap",
          text: "Flagged: “Requests depend on someone remembering”.",
        },
        {
          kind: "gap",
          text: "Flagged: “No follow-up when a request is ignored”.",
        },
      ],
    },
    {
      id: "consistency",
      title: "Consistency Gap",
      items: [
        {
          kind: "observed",
          text: "With ~50 completed jobs per month (estimate), an ad-hoc process means an unknown share of customers are never asked. The gap is invisible precisely because nothing is tracked.",
        },
      ],
    },
    {
      id: "opportunities",
      title: "Workflow Opportunities",
      items: [
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
      ],
    },
    {
      id: "fit",
      title: "Potential Automation Fit",
      items: [
        {
          kind: "observed",
          text: "Stated tool: Jobber. A universal completion signal (API / webhook) is the intended path for tools like this — native integrations are evaluated on evidence of demand, not assumed.",
        },
        {
          kind: "observed",
          text: "Automation fit: high. The stated answers describe a process that is routine, repetitive, and rule-based — the profile automation handles best.",
        },
      ],
    },
    {
      id: "limitations",
      title: "Data Limitations",
      items: [
        {
          kind: "gap",
          text: "This staging report uses only provided information. Public review data was not independently retrieved or verified.",
        },
        {
          kind: "observed",
          text: "No benchmark figures are shown: MPG Reputation does not publish industry averages it cannot evidence.",
        },
      ],
    },
    {
      id: "next",
      title: "Recommended Next Steps",
      items: [
        {
          kind: "action",
          text: "Write down the current request process end-to-end. If it contains the words “someone remembers”, that is the gap to close first.",
        },
        {
          kind: "action",
          text: "Confirm the review destination link (e.g. the Google review link) is current and shared with everyone who talks to customers.",
        },
        {
          kind: "action",
          text: "When the MPG Reputation pilot opens, the “30 Free Review Requests” trial concept is designed to test exactly this. Availability is not yet public.",
        },
      ],
    },
  ],
};

function ItemIcon({ kind }: { kind: ReportItem["kind"] }) {
  switch (kind) {
    case "observed":
      return <Eye className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />;
    case "provided":
      return <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />;
    case "gap":
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />;
    case "action":
      return <Compass className="mt-0.5 h-4 w-4 shrink-0 text-ember" aria-hidden />;
  }
}

export function ReportView({
  report,
  example,
}: {
  report: ReputationReport;
  example: boolean;
}) {
  return (
    <article>
      {/* report header */}
      <div className="console-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-console-line px-6 py-4">
          <p className="font-mono2 text-[10.5px] uppercase tracking-[0.16em] text-console-mute">
            Reputation Opportunity Report
          </p>
          {example && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 font-mono2 text-[9.5px] uppercase tracking-[0.12em] text-warn">
              <FlaskConical className="h-3 w-3" aria-hidden />
              Synthetic example
            </span>
          )}
        </div>
        <div className="grid gap-6 px-6 py-7 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <p className="font-mono2 text-[9.5px] uppercase tracking-[0.14em] text-console-mute">
              Prepared for
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-bold leading-tight text-console-ink">
              {report.businessName}
            </h1>
            <p className="mt-2 font-mono2 text-[11px] text-console-mute">
              Generated{" "}
              {new Date(report.generatedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="console-card p-4">
            <p className="font-mono2 text-[9.5px] uppercase tracking-[0.14em] text-console-mute">
              Process consistency
            </p>
            <p className="mt-2 font-display text-lg font-semibold leading-snug text-console-ink">
              {BAND_LABEL[report.consistencyBand]}
            </p>
            <p className="mt-1 text-[11.5px] text-console-mute">
              Derived only from your stated answers.
            </p>
          </div>
          <div className="console-card p-4">
            <p className="font-mono2 text-[9.5px] uppercase tracking-[0.14em] text-console-mute">
              Est. monthly request opportunities
            </p>
            <p className="mt-2 font-display text-3xl font-bold text-ember">
              {report.estimatedMonthlyOpportunities ?? "—"}
            </p>
            <p className="mt-1 text-[11.5px] text-console-mute">
              {report.estimatedMonthlyOpportunities
                ? "From your stated job volume. An estimate, not a measurement."
                : "Volume not provided — unknown."}
            </p>
          </div>
        </div>
        {/* legend */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-console-line bg-console-2 px-6 py-3.5">
          {[
            { icon: Eye, label: "Derived from answers", tone: "text-console-ink" },
            { icon: UserRound, label: "Your estimate", tone: "text-warn" },
            { icon: AlertTriangle, label: "Gap / limitation", tone: "text-bad" },
            { icon: Compass, label: "Suggested step", tone: "text-ember" },
          ].map((l) => (
            <span
              key={l.label}
              className="inline-flex items-center gap-1.5 text-[11px] text-console-mute"
            >
              <l.icon className={`h-3.5 w-3.5 ${l.tone}`} aria-hidden />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* sections */}
      <div className="mt-8 space-y-4">
        {report.sections.map((s, i) => (
          <Reveal key={s.id} delay={Math.min(i, 3) * 60}>
            <section className="surface-card overflow-hidden">
              <header className="flex items-baseline gap-4 border-b border-line bg-cream px-6 py-4">
                <span className="font-mono2 text-[11px] text-ink-mute">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="font-display text-[17px] font-semibold text-ink">
                  {s.title}
                </h2>
              </header>
              <ul className="divide-y divide-line">
                {s.items.map((item, j) => (
                  <li key={j} className="flex gap-3.5 px-6 py-4">
                    <ItemIcon kind={item.kind} />
                    <p className="text-[14px] leading-relaxed text-ink-soft">
                      {item.text}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </Reveal>
        ))}
      </div>
    </article>
  );
}

export default function ReputationReport() {
  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <ReportView report={EXAMPLE_REPORT} example />
        <ConversionNextSteps origin="example" />
      </main>
      <SiteFooter />
    </div>
  );
}
