"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ClipboardCheck } from "lucide-react";
import { StagingCtaDialog } from "@/components/marketing/site/StagingCtaDialog";
import { track, FunnelEvents } from "@/components/marketing/funnel";

/** Reusable, noncollecting next step from a real browser-only or example report. */
export function ConversionNextSteps({ origin }: { origin: "check" | "example" }) {
  const [trialInfoOpen, setTrialInfoOpen] = useState(false);
  const isExample = origin === "example";

  return (
    <>
      <section
        aria-labelledby={`mr9-conversion-next-${origin}`}
        className="mt-10 rounded-2xl border border-line bg-card p-6 sm:p-8"
      >
        <p className="kicker inline-flex items-center gap-2 text-ember">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          Your next step
        </p>
        <h2
          id={`mr9-conversion-next-${origin}`}
          className="mt-3 max-w-2xl font-display text-2xl font-bold leading-tight text-ink sm:text-3xl"
        >
          {isExample
            ? "See what your own review-request process could reveal."
            : "Turn this assessment into a more consistent process."}
        </h2>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">
          {isExample
            ? "This is an example based on synthetic answers, not a live business assessment. You can run your own check privately in this browser."
            : "Explore the existing MPG Reputation workflow, compare future plan options, and learn when the 30 Free Review Requests trial concept may become available."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href={isExample ? "/reputation-check" : "/features"}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-ink px-5 py-3 text-[14px] font-semibold text-cream transition-colors hover:bg-ember focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {isExample ? "Run my own free check" : "Explore product features"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-line px-5 py-3 text-[14px] font-semibold text-ink transition-colors hover:border-ember focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            Review trial and plan status
          </Link>
          <button
            type="button"
            onClick={() => {
              track(FunnelEvents.trialDialogOpened, { source: `report-${origin}` });
              setTrialInfoOpen(true);
            }}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-4 py-3 text-[14px] font-medium text-ember transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            Is the trial open?
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-5 text-[12px] leading-relaxed text-ink-mute">
          Internal preview only. No visitor details, trial interest, payment information, or assessment answers are submitted or stored.
        </p>
      </section>
      <StagingCtaDialog
        open={trialInfoOpen}
        onOpenChange={setTrialInfoOpen}
        source={`report-${origin}`}
      />
    </>
  );
}
