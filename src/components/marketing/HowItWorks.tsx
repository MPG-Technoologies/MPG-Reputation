"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section, SectionHeading } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { FlowPipeline } from "@/components/marketing/product/FlowPipeline";
import { EmailMock } from "@/components/marketing/product/EmailMock";
import { HealthMock } from "@/components/marketing/product/SourcesMock";
import { useSeo } from "@/components/marketing/useSeo";

const SETUP_STEPS = [
  {
    title: "Configure the business",
    text: "Business profile and locations, so requests come from a sender your customers recognize.",
  },
  {
    title: "Choose a completion source",
    text: "Quick Complete for teams without software, or the universal completion API/webhook for tools that can emit events.",
  },
  {
    title: "Set the review destination",
    text: "The exact place customers should land — typically your Google review link. The destination is validated so nobody lands on a dead link.",
  },
  {
    title: "Define communication rules",
    text: "Timing, frequency caps, suppression and unsubscribe handling. These rules decide who is eligible for a request — and who is never asked.",
  },
];

const FAQ = [
  {
    q: "Does MPG Reputation guarantee more reviews?",
    a: "No. The product automates legitimate requests. Whether a customer writes a review, what they say, and the rating they give are entirely their choice. What a consistent process removes is the silence of never asking.",
  },
  {
    q: "Can we ask only happy customers?",
    a: "No — that's review gating, and MPG Reputation does not support it. Every eligible customer receives the same neutral request, with no sentiment-based filtering.",
  },
  {
    q: "Do customers need an MPG account or app?",
    a: "Neither. The customer gets one email with one button, which opens your review destination in their browser.",
  },
  {
    q: "Can you tell which Google review came from a request?",
    a: "We track sends and link activity. A click through to the destination is evidence of interest, not proof a review was published — we don't claim attribution we can't verify.",
  },
  {
    q: "What happens when something goes wrong?",
    a: "That's the point of the exception model: failed sends, invalid destinations, integration problems and unusual activity are surfaced to operations instead of failing silently.",
  },
  {
    q: "Which tools does it integrate with?",
    a: "Today: Quick Complete (no integration needed) and the universal completion API/webhook. Native integrations with specific platforms will be added only where pilot evidence supports them.",
  },
];

export default function HowItWorks() {
  useSeo(
    "How It Works",
    "The five-step path from completed service to tracked customer activity — completed service, eligibility, neutral request, customer choice, request tracking.",
  );
  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <section className="paper-grain border-b border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="max-w-3xl">
              <Reveal>
                <p className="kicker text-ember">How it works</p>
              </Reveal>
              <Reveal delay={90}>
                <h1 className="mt-4 font-display text-[clamp(2.1rem,4.4vw,3.4rem)] font-bold leading-[1.08] text-ink">
                  Six steps between a finished job and an honest review.
                </h1>
              </Reveal>
              <Reveal delay={180}>
                <p className="mt-6 text-[16.5px] leading-relaxed text-ink-soft">
                  Four of them are automatic. One belongs to your customer. The
                  last is simply knowing it all happened.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <Section dark className="console-grid">
          <SectionHeading
            dark
            kicker="The workflow"
            title="Completed customer → eligibility → request → one CTA → trusted destination → visibility."
          />
          <div className="mt-12">
            <FlowPipeline dark />
          </div>
        </Section>

        <Section>
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div>
              <SectionHeading
                kicker="One-time setup"
                title="Configured once. Runs itself."
              />
              <ol className="mt-10 space-y-0">
                {SETUP_STEPS.map((s, i) => (
                  <Reveal key={s.title} delay={i * 80}>
                    <li className="relative flex gap-5 pb-10 last:pb-0">
                      {i < SETUP_STEPS.length - 1 && (
                        <span
                          className="absolute left-[15px] top-9 h-full w-px bg-line"
                          aria-hidden
                        />
                      )}
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ember/40 bg-ember-tint font-mono2 text-[11px] font-semibold text-ember">
                        {i + 1}
                      </span>
                      <div>
                        <h3 className="font-display text-[17px] font-semibold text-ink">
                          {s.title}
                        </h3>
                        <p className="mt-1.5 max-w-lg text-[14px] leading-relaxed text-ink-mute">
                          {s.text}
                        </p>
                      </div>
                    </li>
                  </Reveal>
                ))}
              </ol>
            </div>
            <div className="space-y-5 lg:sticky lg:top-24">
              <Reveal delay={120}>
                <EmailMock />
              </Reveal>
              <Reveal delay={220}>
                <HealthMock />
              </Reveal>
            </div>
          </div>
        </Section>

        <Section className="bg-cream">
          <SectionHeading
            kicker="Straight answers"
            title="Questions a careful business owner should ask."
          />
          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={(i % 2) * 90}>
                <div className="surface-card h-full p-6">
                  <h3 className="text-[15.5px] font-semibold text-ink">{f.q}</h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-ink-mute">
                    {f.a}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={160}>
            <div className="mt-12 text-center">
              <Link
                href="/reputation-check"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-ember px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ember-deep"
              >
                Check your own process
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
