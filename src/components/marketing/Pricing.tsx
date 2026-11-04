"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Infinity as InfinityIcon, Crown, ArrowRight, ArrowUpRight, FlaskConical } from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { StagingCtaDialog } from "@/components/marketing/site/StagingCtaDialog";
import { useSeo } from "@/components/marketing/useSeo";
import { track, FunnelEvents } from "@/components/marketing/funnel";

/**
 * Proposed plan categories — configuration-only placeholders.
 * No prices, no allowances, no Premium benefits have been invented or
 * approved. When commercial terms are decided, they slot into this
 * structure without re-architecting the page. Stripe/checkout remain
 * deliberately unactivated.
 */
interface ProposedCategory {
  icon: typeof CalendarClock;
  name: string;
  intent: string;
  status: string;
}

const PROPOSED_CATEGORIES: ProposedCategory[] = [
  {
    icon: CalendarClock,
    name: "Monthly",
    intent: "A rolling monthly arrangement for businesses that want flexibility while they build the review-request habit.",
    status: "Proposed — terms not yet set",
  },
  {
    icon: InfinityIcon,
    name: "Yearly",
    intent: "An annual arrangement for businesses already convinced that consistent requests should be permanent infrastructure.",
    status: "Proposed — terms not yet set",
  },
  {
    icon: Crown,
    name: "Premium",
    intent: "A higher-touch category under consideration for multi-location operators. Its scope has not been defined and no benefits are being claimed.",
    status: "Under consideration — undefined",
  },
];

export default function Pricing() {
  useSeo(
    "Pricing",
    "MPG Reputation pricing is not yet public. Proposed plan categories (Monthly, Yearly, Premium) are shown as structure only — no prices are set, checkout is not active, and the free allowance is explained separately.",
  );
  const [ctaOpen, setCtaOpen] = useState(false);

  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <Section className="border-b border-line">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <p className="kicker inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1.5 text-warn">
                <FlaskConical className="h-3 w-3" aria-hidden />
                Prelaunch — no public pricing yet
              </p>
              <h1 className="mt-6 font-display text-[clamp(2rem,4.4vw,3.2rem)] font-bold leading-[1.08] text-ink">
                Pricing designed to grow with your business
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
                We are preparing flexible plan options for service businesses of different sizes. Final plan details are still being reviewed. Subscriptions and checkout are not available in this preview.
              </p>
            </Reveal>
          </div>
        </Section>

        <Section>
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <h2 className="font-display text-[clamp(1.5rem,2.8vw,2.1rem)] font-bold text-ink">
                Proposed plan categories
              </h2>
              <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">
                Explore possible subscription formats. Prices, included allowances and benefits will be displayed only after approval. These cards are previews, not purchase offers.
              </p>
            </Reveal>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {PROPOSED_CATEGORIES.map((c, i) => (
                <Reveal key={c.name} delay={i * 90}>
                  <div className="surface-card flex h-full flex-col p-6">
                    <c.icon className="h-6 w-6 text-ember" aria-hidden />
                    <h3 className="mt-4 font-display text-xl font-bold text-ink">
                      {c.name}
                    </h3>
                    <p className="mt-1 font-mono2 text-[10px] uppercase tracking-[0.12em] text-warn">
                      {c.status}
                    </p>
                    <p className="mt-4 flex-1 text-[13.5px] leading-relaxed text-ink-soft">
                      {c.intent}
                    </p>
                    <div className="mt-6 border-t border-line pt-4">
                      <p className="font-display text-2xl font-bold text-ink-mute">
                        Details coming
                      </p>
                      <p className="mt-1 text-[12px] text-ink-mute">
                        Not yet available for purchase
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Section>

        <Section className="bg-cream">
          <div className="mx-auto max-w-3xl">
            <Reveal>
              <h2 className="font-display text-[clamp(1.5rem,2.8vw,2.1rem)] font-bold text-ink">
                What does 30 Free Review Requests mean?
              </h2>
              <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
                Independent of any future plan, the trial concept being
                developed is <strong className="text-ink">30 Free Review Requests</strong>:
                thirty review requests or thirty days, whichever occurs first,
                email-first. It exists to answer one question — does a
                consistent, automated request process change anything for your
                business?
              </p>
            </Reveal>
            <Reveal delay={110}>
              <div className="mt-7 space-y-3">
                {[
                  {
                    t: "A review request is not a review",
                    d: "Your allowance counts neutral invitations sent to customers — never published reviews, which no tool can create or guarantee.",
                  },
                  {
                    t: "Not a public offer yet",
                    d: "The trial is a development hypothesis. Signup opens only after owner approval; this staging site collects no contact details in the meantime.",
                  },
                  {
                    t: "No payment instrument involved",
                    d: "There is no checkout, no card capture, and no Stripe activation anywhere in this staging environment.",
                  },
                ].map((x) => (
                  <div key={x.t} className="surface-card p-5">
                    <p className="text-[14.5px] font-semibold text-ink">{x.t}</p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-mute">
                      {x.d}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-9 flex flex-col items-center gap-4 text-center">
                <button
                  type="button"
                  onClick={() => {
                    track(FunnelEvents.trialDialogOpened, { source: "pricing" });
                    setCtaOpen(true);
                  }}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-ink px-7 py-3 text-[15px] font-semibold text-cream transition-colors hover:bg-ember"
                >
                  Check trial availability
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </button>
                <p className="text-[13px] text-ink-mute">
                  Questions first?{" "}
                  <Link href="/faq" className="font-medium text-ember underline-offset-4 hover:underline">
                    Read the FAQ
                  </Link>{" "}
                  or{" "}
                  <Link href="/reputation-check" className="font-medium text-ember underline-offset-4 hover:underline">
                    run the free check
                    <ArrowRight className="ml-0.5 inline h-3.5 w-3.5" aria-hidden />
                  </Link>
                </p>
              </div>
            </Reveal>
          </div>
        </Section>
      </main>
      <SiteFooter />
      <StagingCtaDialog
        open={ctaOpen}
        onOpenChange={setCtaOpen}
        source="pricing"
      />
    </div>
  );
}
