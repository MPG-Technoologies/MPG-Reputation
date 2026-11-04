"use client";
import { useEffect } from "react";
import Link from "next/link";
import {
  Lock,
  KeyRound,
  BellOff,
  Eye,
  FileSearch,
  ShieldCheck,
  X,
  Check,
  ArrowRight,
} from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section, SectionHeading } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { useSeo } from "@/components/marketing/useSeo";
import { track, FunnelEvents } from "@/components/marketing/funnel";

const CONTROLS = [
  {
    icon: Lock,
    title: "Tenant isolation",
    text: "Each business operates in its own workspace. Completion data, customer contact details, and activity are scoped to that tenant and not shared across accounts.",
  },
  {
    icon: KeyRound,
    title: "Secure authenticated access",
    text: "The business console sits behind authenticated sign-in. Access is permission-aware, following least-privilege principles.",
  },
  {
    icon: BellOff,
    title: "Suppression & unsubscribe controls",
    text: "Every request carries a working unsubscribe. Opted-out customers are suppressed globally for that business — the automation cannot ask them again.",
  },
  {
    icon: Eye,
    title: "Auditability",
    text: "Every request decision is recorded: the completion signal, the eligibility evaluation, the send, the delivery outcome. You can always answer 'who was asked, when, and why'.",
  },
  {
    icon: FileSearch,
    title: "Minimal-data approach",
    text: "The system is designed around the minimum viable data: a completion signal, a customer contact, and a review destination. Nothing else is required for the core flow.",
  },
  {
    icon: ShieldCheck,
    title: "Safe review destinations",
    text: "Destination links are validated and monitored, so customers consistently land on the review page you intended — not a stale or mistyped URL.",
  },
];

const WONT_SAY = [
  { bad: "\u201cFully compliant\u201d / \u201clegally compliant\u201d", good: "We describe the controls we build, not blanket legal status." },
  { bad: "\u201c100% secure\u201d", good: "No system is. We design for security and say so plainly." },
  { bad: "\u201cCertified\u201d", good: "We claim certifications only when the evidence exists." },
  { bad: "\u201cGuaranteed privacy\u201d", good: "We minimize data and document handling instead of guaranteeing outcomes." },
];

const INTEGRITY = [
  "Requests go to eligible customers regardless of expected sentiment — no review gating.",
  "The same neutral wording for everyone — no steering happy customers to public platforms and unhappy ones elsewhere.",
  "No fake reviews, no paid positive reviews, no review purchasing of any kind.",
  "The customer decides whether to write anything, what to say, and how many stars to give.",
];

export default function Trust() {
  useSeo(
    "Trust & Responsibility",
    "How MPG Reputation handles tenant isolation, authentication, suppression, auditability, minimal data and review integrity — no gating, no positive-only filtering.",
  );

  useEffect(() => {
    track(FunnelEvents.trustViewed);
  }, []);
  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <section className="paper-grain border-b border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="max-w-3xl">
              <Reveal>
                <p className="kicker text-ember">Security &amp; trust</p>
              </Reveal>
              <Reveal delay={90}>
                <h1 className="mt-4 font-display text-[clamp(2.1rem,4.4vw,3.4rem)] font-bold leading-[1.08] text-ink">
                  Designed with security, privacy and responsible messaging
                  controls in mind.
                </h1>
              </Reveal>
              <Reveal delay={180}>
                <p className="mt-6 text-[16.5px] leading-relaxed text-ink-soft">
                  A review-request system handles your customer relationships.
                  It should be built — and described — with restraint. Here is
                  what MPG Reputation does, stated without theatre.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <Section dark className="console-grid">
          <SectionHeading
            dark
            kicker="The controls"
            title="What the system is built to enforce."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CONTROLS.map((c, i) => (
              <Reveal key={c.title} delay={i * 70}>
                <div className="console-card h-full p-6">
                  <c.icon className="h-5 w-5 text-ember" aria-hidden />
                  <h3 className="mt-3 text-[15.5px] font-semibold text-console-ink">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-console-mute">
                    {c.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <SectionHeading
                kicker="Language discipline"
                title="What we won't say — and what we say instead."
                lede="Trust is built by accurate sentences. These are the claims you will not find on this site, and the honest versions we use."
              />
            </div>
            <div className="surface-card divide-y divide-line overflow-hidden">
              {WONT_SAY.map((w, i) => (
                <Reveal key={w.bad} delay={i * 60}>
                  <div className="grid gap-2 p-5 sm:grid-cols-[1fr_1.2fr] sm:gap-6">
                    <p className="flex items-start gap-2.5 text-[13.5px] font-medium text-bad">
                      <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {w.bad}
                    </p>
                    <p className="flex items-start gap-2.5 text-[13.5px] text-ink-soft">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                      {w.good}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Section>

        <Section id="integrity" className="bg-cream">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
            <SectionHeading
              kicker="Review integrity"
              title="Built to request genuine feedback. Nothing else."
              lede="Review platforms, regulators, and customers all agree on the rules. So do we — and they're product constraints, not marketing copy."
            />
            <ul className="space-y-3">
              {INTEGRITY.map((t, i) => (
                <Reveal key={t} delay={i * 70}>
                  <li className="surface-card flex items-start gap-3.5 p-5">
                    <ShieldCheck
                      className="mt-0.5 h-5 w-5 shrink-0 text-ember"
                      aria-hidden
                    />
                    <span className="text-[14.5px] leading-relaxed text-ink-soft">
                      {t}
                    </span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
          <Reveal delay={140}>
            <div className="mt-12 flex flex-col items-start gap-3 rounded-xl border border-line bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[14.5px] text-ink-soft">
                Want to see how these principles show up in your own process?
              </p>
              <Link
                href="/reputation-check"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-ink px-6 py-3 text-[15px] font-semibold text-cream transition-colors hover:bg-ember"
              >
                Run the Free Reputation Check
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </Reveal>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
