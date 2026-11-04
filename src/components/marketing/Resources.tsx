"use client";
import Link from "next/link";
import { ArrowRight, BookOpen, FileText, MessagesSquare } from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section, SectionHeading } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { useSeo } from "@/components/marketing/useSeo";

/**
 * Editorial categories (MR-10 foundation). Every future article carries one
 * of these — the taxonomy ships before the content so internal linking and
 * SEO architecture have a stable skeleton to grow into.
 */
const EDITORIAL_CATEGORIES = [
  { name: "Request Craft", d: "Wording, timing and neutrality of the ask itself." },
  { name: "Process Design", d: "Building a request habit that doesn't depend on memory." },
  { name: "Ethics & Policy", d: "Platform rules, gating prohibitions and customer choice." },
  { name: "Measurement", d: "What request activity data can — and cannot — tell you." },
] as const;

const PLANNED = [
  {
    icon: FileText,
    title: "The anatomy of a neutral review request",
    tag: "Request Craft · planned",
    text: "What wording works, what crosses the line into steering, and how platform policies treat solicitation.",
  },
  {
    icon: BookOpen,
    title: "Timing requests after completed work",
    tag: "Process Design · planned",
    text: "What the pilot program is designed to measure about send timing, frequency caps, and follow-up.",
  },
  {
    icon: MessagesSquare,
    title: "Responding to reviews — the human half",
    tag: "Measurement · planned",
    text: "Automation handles the asking. Responding well is still yours. Practical patterns for owners.",
  },
];

export default function Resources() {
  useSeo(
    "Resources",
    "Guides for local service businesses on building an honest review-request process.",
  );
  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <section className="paper-grain border-b border-line">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="max-w-3xl">
              <Reveal>
                <p className="kicker text-ember">Resources</p>
              </Reveal>
              <Reveal delay={90}>
                <h1 className="mt-4 font-display text-[clamp(2.1rem,4.4vw,3.4rem)] font-bold leading-[1.08] text-ink">
                  Education before acquisition.
                </h1>
              </Reveal>
              <Reveal delay={180}>
                <p className="mt-6 text-[16.5px] leading-relaxed text-ink-soft">
                  This area will host practical guides on running an honest,
                  consistent review-request process. It&apos;s intentionally sparse:
                  content ships when it&apos;s genuinely useful, not to fill a
                  template.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <Section>
          <SectionHeading
            kicker="Editorial categories"
            title="Four shelves, no filler."
            lede="The library's structure is fixed before a single article ships — so every future piece has a defined job in the customer journey."
          />
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {EDITORIAL_CATEGORIES.map((c, i) => (
              <Reveal key={c.name} delay={i * 70}>
                <div className="h-full rounded-xl border border-line bg-card p-5">
                  <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-ember">
                    Category {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-2 text-[15px] font-semibold text-ink">
                    {c.name}
                  </h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-mute">
                    {c.d}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section className="bg-cream">
          <SectionHeading
            kicker="In preparation"
            title="What's coming to this library."
          />
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {PLANNED.map((p, i) => (
              <Reveal key={p.title} delay={i * 90}>
                <div className="surface-card flex h-full flex-col p-6">
                  <p.icon className="h-5 w-5 text-ember" aria-hidden />
                  <p className="mt-3 kicker text-ink-mute">{p.tag}</p>
                  <h3 className="mt-2 font-display text-[17px] font-semibold text-ink">
                    {p.title}
                  </h3>
                  <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-ink-mute">
                    {p.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={160}>
            <div className="mt-12 rounded-xl border border-dashed border-line bg-cream p-6 text-center">
              <p className="text-[13.5px] text-ink-mute">
                Customer evidence will appear here after validated pilot
                results — no invented testimonials, case studies, or numbers.
              </p>
            </div>
          </Reveal>
          <Reveal delay={220}>
            <div className="mt-10 text-center">
              <Link
                href="/reputation-check"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-ember px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ember-deep"
              >
                In the meantime, check your process
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
