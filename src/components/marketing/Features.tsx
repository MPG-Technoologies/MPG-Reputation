"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  Send,
  LayoutDashboard,
  Target,
  Activity,
  Gauge,
  MapPin,
  HeartHandshake,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { StagingCtaDialog } from "@/components/marketing/site/StagingCtaDialog";
import {
  QuickCompleteMock,
  ApiSourceMock,
  HealthMock,
} from "@/components/marketing/product/SourcesMock";
import { DashboardMock } from "@/components/marketing/product/DashboardMock";
import { EmailMock } from "@/components/marketing/product/EmailMock";
import { useSeo } from "@/components/marketing/useSeo";
import { track, FunnelEvents } from "@/components/marketing/funnel";

interface FeatureBlock {
  icon: typeof Send;
  title: string;
  problem: string;
  does: string;
  experience: string;
  connects: string;
  status: "In product" | "Planned";
  mock?: "quick" | "api" | "health" | "dashboard" | "email";
}

const BLOCKS: FeatureBlock[] = [
  {
    icon: ClipboardCheck,
    title: "Quick Complete",
    problem: "Most local service businesses don't run dispatch software — so most review automation tools can't even start.",
    does: "A one-tap signal in the MPG console that says “this job is done.” That single action is the trigger everything else hangs off.",
    experience: "The owner finishes the work, opens the console, taps Complete next to the customer. Two seconds, no training.",
    connects: "Feeds the eligibility engine that decides whether a review request should be created for this completion.",
    status: "In product",
    mock: "quick",
  },
  {
    icon: Send,
    title: "Review Request Automation",
    problem: "Requests that depend on memory don't happen — and follow-up that depends on enthusiasm doesn't scale.",
    does: "After an eligible completion, a neutral request email is created and sent automatically. Every rule — eligibility, suppression, frequency — is evaluated before anything goes out. Follow-up reminders are bounded: rule-based and limited, never unlimited chasing.",
    experience: "The owner doesn't write, schedule, or chase anything. They see requests leave and see the reason when one doesn't.",
    connects: "Writes to the customer activity trail and the usage ledger — every request is counted and accountable.",
    status: "In product",
    mock: "health",
  },
  {
    icon: LayoutDashboard,
    title: "Business Dashboard",
    problem: "Without visibility, owners can't tell a working process from a broken one until reviews dry up.",
    does: "One screen for requests sent, delivery outcomes, tracked-link activity, exceptions needing attention, and trial usage.",
    experience: "Check it in the morning like a weather forecast. Green means the routine is running; anything unusual is already surfaced.",
    connects: "Reads from the same event trail the automation writes — the dashboard can't hide a failure.",
    status: "In product",
    mock: "dashboard",
  },
  {
    icon: Target,
    title: "Review Destination Management",
    problem: "A review request is only as good as the link inside it. Stale or wrong destinations silently waste every request.",
    does: "Each location configures one validated review destination (for example, its Google review link). Requests always carry the tracked, current destination.",
    experience: "Set it once per location. If the destination changes, update it in one place — every future request follows.",
    connects: "Clicks on the tracked destination link are recorded back into customer activity.",
    status: "In product",
  },
  {
    icon: Activity,
    title: "Customer Activity",
    problem: "“Did we ask them?” should be a lookup, not an argument about who remembers what.",
    does: "A complete per-customer trail: request scheduled, sent, delivered, tracked-link clicked, failed with reason, or suppressed. Provider open-tracking is deliberately ignored — MPG records its own authoritative click events instead.",
    experience: "Answer any “what happened with this customer?” question in seconds, with timestamps.",
    connects: "Suppression events here feed back into the automation — an opted-out customer can never be asked again.",
    status: "In product",
  },
  {
    icon: Gauge,
    title: "Usage Tracking",
    problem: "Trials that hide their own limits breed distrust before the product has a chance.",
    does: "The trial allowance is a visible counter: requests used, requests remaining, days left — always accurate, always on screen.",
    experience: "You always know exactly where you stand. No surprise cutoffs, no fine print arithmetic.",
    connects: "Shares its ledger with the billing concepts — the same counts will drive plan allowances when pricing is approved.",
    status: "In product",
  },
  {
    icon: MapPin,
    title: "Multi-location Configuration",
    problem: "A second location usually means a second informal process — and double the inconsistency.",
    does: "One organization, many locations. Customers, review destinations, requests and usage are scoped per location, with team members assigned where they work.",
    experience: "See each site's activity separately, or the organization as a whole. Add a location without rebuilding anything.",
    connects: "Location scoping is enforced at the database level — cross-site data leaks are structurally impossible.",
    status: "In product",
  },
  {
    icon: HeartHandshake,
    title: "Responsible Customer Communication",
    problem: "Nobody wants to be the business that hounds its own customers — and mailbox providers punish the ones that do.",
    does: "Working unsubscribe in every message, automatic permanent suppression after hard bounces or complaints, neutral request wording identical for every customer, and suppression records stored as hashes rather than readable addresses.",
    experience: "You never manage an opt-out list by hand. The system treats “don't ask me again” as law, not as a suggestion.",
    connects: "Suppression sits in the pre-send evaluation of every future request — it cannot be bypassed by a busy day.",
    status: "In product",
  },
  {
    icon: Send,
    title: "Native Integrations",
    problem: "Businesses on Jobber, Housecall Pro or ServiceTitan shouldn't have to double-enter completions.",
    does: "A signed completion API/webhook already exists so external tools can report finished jobs directly. Native one-click integrations with specific platforms are evaluated on evidence of demand — not promised in advance.",
    experience: "Today: connect via the completion API. Tomorrow: dedicated connectors if demand justifies them.",
    connects: "Same trigger as Quick Complete — one more way to say “the job is done.”",
    status: "Planned",
    mock: "api",
  },
];

function Mock({ kind }: { kind: NonNullable<FeatureBlock["mock"]> }) {
  switch (kind) {
    case "quick":
      return <QuickCompleteMock />;
    case "api":
      return <ApiSourceMock />;
    case "health":
      return <HealthMock />;
    case "dashboard":
      return <DashboardMock />;
    case "email":
      return <EmailMock />;
  }
}

export default function Features() {
  useSeo(
    "Features",
    "Every MPG Reputation capability — Quick Complete, request automation, dashboard, destinations, activity, usage, multi-location, responsible communication — explained honestly, with its verified status.",
  );
  const [ctaOpen, setCtaOpen] = useState(false);

  useEffect(() => {
    track(FunnelEvents.featuresViewed);
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <Section className="border-b border-line">
          <div className="max-w-3xl">
            <Reveal>
              <p className="kicker text-ember">Features</p>
              <h1 className="mt-4 font-display text-[clamp(2rem,4.4vw,3.2rem)] font-bold leading-[1.08] text-ink">
                What MPG Reputation actually does — capability by capability.
              </h1>
              <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
                Each feature below is described with the problem it addresses,
                what the business owner experiences, and how it connects to the
                rest of the workflow. Capabilities marked{" "}
                <span className="font-semibold text-ok">In product</span> are
                verified in the running system; anything else is labelled
                honestly as planned.
              </p>
            </Reveal>
          </div>
        </Section>

        {BLOCKS.map((b, i) => (
          <Section key={b.title} className={i % 2 === 1 ? "bg-cream" : ""}>
            <div
              className={`grid items-center gap-10 ${
                b.mock ? "lg:grid-cols-2" : ""
              }`}
            >
              <Reveal className={b.mock && i % 2 === 1 ? "lg:order-2" : ""}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-card">
                    <b.icon className="h-5 w-5 text-ember" aria-hidden />
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 font-mono2 text-[9.5px] font-medium uppercase tracking-[0.12em] ${
                      b.status === "In product"
                        ? "border-ok/30 bg-ok/10 text-ok"
                        : "border-warn/40 bg-warn/10 text-warn"
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
                <h2 className="mt-5 font-display text-[clamp(1.5rem,2.6vw,2rem)] font-bold text-ink">
                  {b.title}
                </h2>
                <p className="mt-2 text-[13px] font-medium uppercase tracking-wide text-ink-mute">
                  {b.problem}
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
                  {b.does}
                </p>
                <div className="mt-5 space-y-3 border-l-2 border-ember/40 pl-5">
                  <p className="text-[13.5px] leading-relaxed text-ink-soft">
                    <span className="font-semibold text-ink">Owner experience: </span>
                    {b.experience}
                  </p>
                  <p className="text-[13.5px] leading-relaxed text-ink-soft">
                    <span className="font-semibold text-ink">Workflow connection: </span>
                    {b.connects}
                  </p>
                </div>
              </Reveal>
              {b.mock && (
                <Reveal delay={140} className={i % 2 === 1 ? "lg:order-1" : ""}>
                  <Mock kind={b.mock} />
                </Reveal>
              )}
            </div>
          </Section>
        ))}

        <Section dark className="console-grid">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <h2 className="font-display text-[clamp(1.7rem,3.4vw,2.4rem)] font-bold text-console-ink">
                See it in motion, then test your own process.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-console-mute">
                The homepage walks through a complete job end-to-end. The free
                check shows where your own request process stands today.
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/how-it-works"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-ember px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ember-deep"
                >
                  See how it works
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="/reputation-check"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-console-line bg-console-2 px-6 py-3 text-[15px] font-semibold text-console-ink transition-colors hover:border-console-mute"
                >
                  Free Reputation Check
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    track(FunnelEvents.trialDialogOpened, { source: "features" });
                    setCtaOpen(true);
                  }}
                  className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-[14px] font-medium text-console-mute transition-colors hover:text-ember"
                >
                  30 Free Review Requests concept
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </Reveal>
          </div>
        </Section>
      </main>
      <SiteFooter />
      <StagingCtaDialog
        open={ctaOpen}
        onOpenChange={setCtaOpen}
        source="features"
      />
    </div>
  );
}
