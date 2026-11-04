"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  X,
  Check,
  ShieldCheck,
  Lock,
  Eye,
  BellOff,
  FileSearch,
  KeyRound,
  ClipboardCheck,
  Send,
  LayoutDashboard,
  Target,
  Activity,
  Gauge,
  MapPin,
  HeartHandshake,
} from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section, SectionHeading } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { StagingCtaDialog } from "@/components/marketing/site/StagingCtaDialog";
import { DashboardMock } from "@/components/marketing/product/DashboardMock";
import { FlowPipeline } from "@/components/marketing/product/FlowPipeline";
import { DemoWalkthrough } from "@/components/marketing/product/DemoWalkthrough";
import {
  QuickCompleteMock,
  ApiSourceMock,
  HealthMock,
} from "@/components/marketing/product/SourcesMock";
import { useSeo } from "@/components/marketing/useSeo";
import { track, FunnelEvents } from "@/components/marketing/funnel";

/* ---------- HERO ---------- */
function Hero({ onTrialCta }: { onTrialCta: () => void }) {
  return (
    <section className="paper-grain relative overflow-hidden border-b border-line">
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <Reveal>
              <p className="kicker inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-ink-mute">
                <span className="h-1.5 w-1.5 rounded-full bg-ember" aria-hidden />
                Responsible review-request automation
              </p>
            </Reveal>
            <Reveal delay={90}>
              <h1 className="mt-6 font-display text-[clamp(2.4rem,5.2vw,4rem)] font-bold leading-[1.05] text-ink">
                Great service deserves{" "}
                <span className="text-ember">to be heard.</span>
              </h1>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-ink-soft">
                MPG Reputation helps businesses consistently request honest
                customer feedback after completed services through responsible
                review-request automation. You finish the work — the system
                makes sure the ask actually happens.
              </p>
            </Reveal>
            <Reveal delay={260}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/reputation-check"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3 text-[15px] font-semibold text-cream transition-colors hover:bg-ember"
                >
                  Free Reputation Check
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-ink/20 bg-card px-6 py-3 text-[15px] font-semibold text-ink transition-colors hover:border-ink"
                >
                  See How It Works
                </Link>
              </div>
            </Reveal>
            <Reveal delay={330}>
              <button
                type="button"
                onClick={onTrialCta}
                className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 text-[13.5px] font-medium text-ink-mute transition-colors hover:text-ember"
              >
                Preview: 30 Free Review Requests
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Reveal>
          </div>
          <Reveal delay={200} className="relative">
            <div
              className="pointer-events-none absolute -inset-4 rounded-[32px] bg-[radial-gradient(closest-side,hsl(var(--ember)/0.10),transparent)] sm:-inset-8"
              aria-hidden
            />
            <DashboardMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- PROBLEM ---------- */
function Problem() {
  const items = [
    { t: "Customers forget", d: "Happy customers leave, life moves on, and the review they meant to write never happens.", bad: false },
    { t: "Staff forget to ask", d: "The request lives in someone's head — and heads are busy when business is good.", bad: false },
    { t: "Manual follow-up eats time", d: "Chasing reviews by hand doesn't scale past a handful of jobs a week.", bad: false },
    { t: "Requests go out inconsistently", d: "Some customers get asked, most don't — and there's no pattern to why.", bad: true },
    { t: "Owners can't see what's happening", d: "No record of who was asked, when, or what happened next. The process is invisible.", bad: true },
  ];
  return (
    <Section id="problem" className="bg-cream">
      <SectionHeading
        kicker="The business problem"
        title="Reviews don't fail because customers are unhappy. They fail because nobody asks."
        lede="Completed work is your best reputation asset — and the easiest to waste. The failure isn't service quality; it's a process that depends on memory."
      />
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((s, i) => (
          <Reveal key={s.t} delay={i * 70}>
            <div
              className={`flex h-full flex-col rounded-xl border p-5 ${
                s.bad ? "border-bad/25 bg-card" : "border-line bg-card"
              }`}
            >
              <span className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-ink-mute">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p
                className={`mt-5 text-[14.5px] font-semibold leading-snug ${
                  s.bad ? "text-bad" : "text-ink"
                }`}
              >
                {s.t}
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-mute">
                {s.d}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------- HOW IT WORKS ---------- */
function HowItWorks() {
  return (
    <Section dark className="console-grid">
      <SectionHeading
        dark
        kicker="How MPG Reputation solves it"
        title="Completed service → eligibility → request → customer choice → tracked activity."
        lede="Configure your business, completion source, review destination and messaging rules once. Eligible requests then happen automatically — and anything unusual is surfaced for attention instead of failing silently."
      />
      <div className="mt-12">
        <FlowPipeline dark />
      </div>
      <Reveal delay={150}>
        <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-console-mute">
          Note on honesty: MPG Reputation tracks requests and tracked-link
          activity. A click through to your review destination is not proof a
          review was published — the decision, the wording, and the star rating
          always belong to the customer.
        </p>
      </Reveal>
    </Section>
  );
}

/* ---------- FEATURE SHOWCASE ---------- */
const FEATURES = [
  {
    icon: ClipboardCheck,
    title: "Quick Complete",
    problem: "No customer-management software to hook into",
    experience: "Tap once when a job is done. That single signal starts the whole process.",
  },
  {
    icon: Send,
    title: "Review Request Automation",
    problem: "Requests depend on someone remembering",
    experience: "Neutral requests send automatically after eligible completions — with bounded reminders, never unlimited chasing.",
  },
  {
    icon: LayoutDashboard,
    title: "Business Dashboard",
    problem: "Owners can't see the process",
    experience: "Requests sent, delivery, exceptions and trial usage in one place. You check it; you don't operate it.",
  },
  {
    icon: Target,
    title: "Review Destination Management",
    problem: "Customers land on stale or wrong links",
    experience: "One validated review destination per location, tracked so link activity is visible.",
  },
  {
    icon: Activity,
    title: "Customer Activity",
    problem: "No record of who was asked",
    experience: "A complete trail: scheduled, sent, delivered, clicked, failed or suppressed — with the reason.",
  },
  {
    icon: Gauge,
    title: "Usage Tracking",
    problem: "Unclear what a trial actually includes",
    experience: "Your remaining review-request allowance is always visible — no surprises, no fine print.",
  },
  {
    icon: MapPin,
    title: "Multi-location Configuration",
    problem: "Each branch runs its own informal process",
    experience: "Locations, customers, destinations and usage stay scoped per site under one organization.",
  },
  {
    icon: HeartHandshake,
    title: "Responsible Customer Communication",
    problem: "Nobody wants to spam their own customers",
    experience: "Working unsubscribe, automatic suppression after hard bounces or complaints, and neutral wording for everyone.",
  },
] as const;

function FeatureShowcase() {
  return (
    <Section id="features">
      <SectionHeading
        kicker="Existing feature showcase"
        title="Built, not promised. Every capability below exists in the product today."
        lede="These are real systems from the MPG Reputation codebase — represented here with staged interfaces and synthetic data, not aspirational mockups of imagined features."
      />
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 4) * 70}>
            <div className="surface-card flex h-full flex-col p-5">
              <div className="flex items-center justify-between">
                <f.icon className="h-5 w-5 text-ember" aria-hidden />
                <span className="rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono2 text-[9px] font-medium uppercase tracking-[0.1em] text-ok">
                  In product
                </span>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-ink">
                {f.title}
              </h3>
              <p className="mt-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-mute">
                {f.problem}
              </p>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">
                {f.experience}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        <Reveal><QuickCompleteMock /></Reveal>
        <Reveal delay={100}><ApiSourceMock /></Reveal>
        <Reveal delay={200}><HealthMock /></Reveal>
      </div>
      <Reveal delay={160}>
        <p className="mt-6 text-center text-[13px] text-ink-mute">
          Completion sources today: Quick Complete and the signed completion
          API/webhook.{" "}
          <Link href="/features" className="font-medium text-ember underline-offset-4 hover:underline">
            Explore every feature in depth
          </Link>
        </p>
      </Reveal>
    </Section>
  );
}

/* ---------- PRODUCT DEMONSTRATION ---------- */
function Demo() {
  return (
    <Section className="bg-cream">
      <SectionHeading
        kicker="Product demonstration"
        title="Watch one job travel through the system."
        lede="Step through what actually happens between a finished service and a visible result — the same journey your customers and your team would take."
      />
      <div className="mt-12">
        <DemoWalkthrough />
      </div>
    </Section>
  );
}

/* ---------- TRIAL ---------- */
function TrialConcept({ onTrialCta }: { onTrialCta: () => void }) {
  return (
    <Section>
      <div className="mx-auto max-w-3xl text-center">
        <SectionHeading
          align="center"
          kicker="Free trial information"
          title="30 Free Review Requests"
          lede="The current trial concept: thirty review requests or thirty days, whichever occurs first. Email-first. Enough to learn whether a consistent request process changes anything for your business — before you pay anything."
        />
        <Reveal delay={120}>
          <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {[
              { v: "30", l: "review requests" },
              { v: "30", l: "days" },
              { v: "1st", l: "whichever occurs first" },
            ].map((x) => (
              <div key={x.l} className="surface-card p-5">
                <p className="font-display text-3xl font-bold text-ember">{x.v}</p>
                <p className="mt-1 text-[12.5px] text-ink-mute">{x.l}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="mx-auto mt-8 max-w-xl rounded-xl border border-line bg-cream p-6 text-left">
            <p className="kicker text-ink">What a review request is — and isn&apos;t</p>
            <ul className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed text-ink-soft">
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                A review request is the neutral invitation we send to your customer after completed work.
              </li>
              <li className="flex gap-2.5">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />
                It is not a review. We can&apos;t create, guarantee, or influence published Google reviews — only the customer decides to write one.
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                Your allowance counts requests sent — not reviews received.
              </li>
            </ul>
          </div>
        </Reveal>
        <Reveal delay={260}>
          <p className="mt-6 text-[13px] leading-relaxed text-ink-mute">
            Staging note: this is a development hypothesis, not a frozen public
            offer. No pricing has been approved, and trial signup is not yet
            open.
          </p>
          <button
            type="button"
            onClick={onTrialCta}
            className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-ink px-6 py-3 text-[15px] font-semibold text-cream transition-colors hover:bg-ember"
          >
            Explore trial availability
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </button>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------- FREE CHECK ---------- */
function FreeCheck() {
  const sections = [
    "Current Snapshot",
    "Review Request Process",
    "Consistency Gap",
    "Workflow Opportunities",
    "Potential Automation Fit",
    "Data Limitations",
    "Recommended Next Steps",
  ];
  return (
    <Section id="reputation-check" className="bg-cream">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionHeading
            kicker="Free Reputation Check"
            title="See where your review process is losing opportunities."
            lede="A five-minute self-assessment of how your business handles review requests today — practices, follow-up consistency, tracking. Your report highlights patterns derived from your answers; public review data is not fetched or verified."
          />
          <Reveal delay={120}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/reputation-check"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-ember px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ember-deep"
              >
                Start the Free Check
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/reputation-report"
                className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-ink/20 bg-card px-6 py-3 text-[15px] font-semibold text-ink transition-colors hover:border-ink"
              >
                View an example report
              </Link>
            </div>
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-5 max-w-lg text-[12.5px] leading-relaxed text-ink-mute">
              No contact details are collected. We deliberately do not show a
              proprietary &quot;Reputation Score&quot; — numbers without evidence aren&apos;t
              useful.
            </p>
          </Reveal>
        </div>
        <Reveal delay={150}>
          <div className="surface-card overflow-hidden">
            <div className="border-b border-line bg-ink px-5 py-3.5">
              <p className="font-mono2 text-[10.5px] uppercase tracking-[0.14em] text-cream/70">
                Reputation Opportunity Report · contents
              </p>
            </div>
            <ol className="divide-y divide-line">
              {sections.map((s, i) => (
                <li key={s} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="font-mono2 text-[11px] text-ink-mute">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[14px] font-medium text-ink">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------- TRUST ---------- */
function TrustStrip() {
  const trust = [
    { icon: Lock, t: "Tenant isolation", d: "Each business's data is scoped to its own organization — enforced at the database level with row-level security." },
    { icon: KeyRound, t: "Authenticated access", d: "The console sits behind secure sign-in with role-based, least-privilege access." },
    { icon: BellOff, t: "Suppression & unsubscribe", d: "Opted-out customers are never asked again. Suppressed contacts are stored as hashes, not readable addresses." },
    { icon: Eye, t: "Auditability", d: "Every request decision leaves a trace: who was asked, when, and why not." },
    { icon: FileSearch, t: "Minimal data", d: "The system needs a completion signal and a contact — nothing more." },
    { icon: ShieldCheck, t: "Safe destinations", d: "Review links are validated so customers land where you intend." },
  ];
  return (
    <Section dark className="console-grid">
      <SectionHeading
        dark
        kicker="Trust & responsibility"
        title="Designed for honest feedback, neutral solicitation and customer choice."
        lede="No compliance theatre, no certification claims we can't evidence. Just the controls a review-request system owes both businesses and their customers."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {trust.map((x, i) => (
          <Reveal key={x.t} delay={i * 70}>
            <div className="console-card h-full p-5">
              <x.icon className="h-5 w-5 text-ember" aria-hidden />
              <p className="mt-3 text-[15px] font-semibold text-console-ink">{x.t}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-console-mute">{x.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={160}>
        <div className="mt-10 rounded-xl border border-ember/30 bg-ember/5 p-6 sm:p-8">
          <p className="kicker text-ember">Review integrity — a product principle</p>
          <div className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {[
              "No fake reviews — ever",
              "No paid positive reviews",
              "No sentiment-based review gating",
              "No positive-only filtering",
            ].map((t) => (
              <p key={t} className="flex items-center gap-2.5 text-[14.5px] font-medium text-console-ink">
                <X className="h-4 w-4 shrink-0 text-ember" aria-hidden />
                {t}
              </p>
            ))}
          </div>
          <p className="mt-5 max-w-3xl text-[13.5px] leading-relaxed text-console-mute">
            Every eligible customer gets the same neutral request. The content
            and the rating always belong to the customer.{" "}
            <Link href="/trust" className="font-medium text-ember underline-offset-4 hover:underline">
              Read the full trust position
            </Link>
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

/* ---------- FAQ HIGHLIGHTS ---------- */
function FaqHighlights() {
  const faqs = [
    {
      q: "Does MPG Reputation create or guarantee reviews?",
      a: "No. It automates neutral requests. Whether a customer writes a review, what they say, and the rating they give is entirely their choice.",
    },
    {
      q: "What does “30 Free Review Requests” actually mean?",
      a: "Thirty neutral invitations sent to your customers — or thirty days, whichever comes first. Requests sent, not reviews received.",
    },
    {
      q: "Do my customers need an account or app?",
      a: "Neither. One email, one button, and they land directly on your review destination.",
    },
    {
      q: "What if a customer unsubscribes?",
      a: "They're suppressed immediately and permanently for your business — the automation cannot ask them again.",
    },
  ];
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div>
          <SectionHeading
            kicker="Questions, answered"
            title="The things business owners ask first."
            lede="Straight answers about what the product does, what it doesn't, and where it stands today."
          />
          <Reveal delay={140}>
            <Link
              href="/faq"
              className="mt-7 inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-ink/20 bg-card px-6 py-3 text-[15px] font-semibold text-ink transition-colors hover:border-ink"
            >
              Read the full FAQ
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Reveal>
        </div>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={i * 70}>
              <div className="surface-card p-5">
                <h3 className="text-[15px] font-semibold text-ink">{f.q}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-mute">{f.a}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ---------- FINAL CTA ---------- */
function FinalCta({ onTrialCta }: { onTrialCta: () => void }) {
  return (
    <section className="paper-grain border-t border-line">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="kicker text-ember">Prelaunch — and honest about it</p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.1] text-ink">
            Build a review-request habit that doesn&apos;t depend on memory.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-ink-soft">
            Start with the free check — five minutes that show exactly where
            requests are being lost. Trial access opens after owner approval;
            this internal preview does not collect interest or contact details.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/reputation-check"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-ember px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ember-deep"
            >
              Free Reputation Check
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={onTrialCta}
              className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-ink/20 bg-card px-7 py-3 text-[15px] font-semibold text-ink transition-colors hover:border-ink"
            >
              Explore trial availability
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default function Home() {
  useSeo(
    "Home",
    "MPG Reputation helps businesses consistently request honest customer feedback after completed services through responsible review-request automation.",
  );
  const [ctaOpen, setCtaOpen] = useState(false);
  const [ctaSource, setCtaSource] = useState("home");

  function openTrialCta(source: string) {
    track(FunnelEvents.trialDialogOpened, { source });
    setCtaSource(source);
    setCtaOpen(true);
  }

  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <Hero onTrialCta={() => openTrialCta("home-hero")} />
        <Problem />
        <HowItWorks />
        <FeatureShowcase />
        <Demo />
        <TrialConcept onTrialCta={() => openTrialCta("home-trial")} />
        <FreeCheck />
        <TrustStrip />
        <FaqHighlights />
        <FinalCta onTrialCta={() => openTrialCta("home-final")} />
      </main>
      <SiteFooter />
      <StagingCtaDialog open={ctaOpen} onOpenChange={setCtaOpen} source={ctaSource} />
    </div>
  );
}
