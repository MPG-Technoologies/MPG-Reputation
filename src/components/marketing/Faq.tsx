"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { Section } from "@/components/marketing/site/Section";
import { Reveal } from "@/components/marketing/site/Reveal";
import { StagingCtaDialog } from "@/components/marketing/site/StagingCtaDialog";
import { useSeo } from "@/components/marketing/useSeo";
import { track, FunnelEvents } from "@/components/marketing/funnel";

interface Faq {
  q: string;
  a: string;
}

interface FaqCategory {
  id: string;
  title: string;
  faqs: Faq[];
}

const CATEGORIES: FaqCategory[] = [
  {
    id: "product",
    title: "What the product does",
    faqs: [
      {
        q: "What is MPG Reputation, in one sentence?",
        a: "It's a review-request automation platform: after a completed service, it sends your customer a neutral invitation to leave a review, and records everything that happens along the way.",
      },
      {
        q: "Does MPG Reputation create, write, or guarantee reviews?",
        a: "No — on all three counts. The product automates requests. Whether a review is written, what it says, and the star rating are entirely the customer's decision. No honest tool can promise published reviews, and we don't.",
      },
      {
        q: "How does a job become a review request?",
        a: "A completed service is recorded via Quick Complete (one tap in the console) or the signed completion API from your existing tools. The system then evaluates eligibility, suppression and frequency rules, and sends a neutral request email only if every rule passes.",
      },
      {
        q: "Do my customers need an account or an app?",
        a: "Neither. The customer receives one email with one button that opens your review destination directly (for example, your Google review link). No logins, no detours.",
      },
      {
        q: "Which review platforms does it work with?",
        a: "Requests point to the review destination you configure per location — a Google review link is the typical choice. The link is validated so customers land where you intend, and clicks on the tracked link are recorded.",
      },
      {
        q: "Can I run more than one location?",
        a: "Yes. One organization can operate multiple locations, with customers, destinations, requests and usage scoped per site. The separation is enforced at the database level, not just visually.",
      },
    ],
  },
  {
    id: "ethics",
    title: "Ethics & responsibility",
    faqs: [
      {
        q: "Does the system filter out unhappy customers before asking?",
        a: "No. There is no review gating and no sentiment-based filtering anywhere in the product. Every eligible customer receives the same neutral request — positive, negative or anything in between.",
      },
      {
        q: "What happens if a customer unsubscribes?",
        a: "They are suppressed immediately and permanently for your business. The automation cannot ask them again, and suppressed contacts are stored as hashes rather than readable addresses.",
      },
      {
        q: "Will it keep emailing customers who ignore the first request?",
        a: "Follow-up is bounded: rule-based reminders with strict limits, never unlimited chasing. The full sequence stops the moment a customer acts or opts out.",
      },
      {
        q: "What does the activity tracking actually prove?",
        a: "It proves what MPG Reputation did: request scheduled, sent, delivered, tracked link clicked, failed with reason. A click is evidence of interest — not proof a review was published. We deliberately ignore provider open-tracking and record our own authoritative events instead.",
      },
    ],
  },
  {
    id: "trial",
    title: "Trial & pricing",
    faqs: [
      {
        q: "What exactly is “30 Free Review Requests”?",
        a: "The current trial concept: thirty review requests or thirty days, whichever occurs first, email-first. It counts requests sent to your customers — not reviews received, which no tool can promise.",
      },
      {
        q: "Can I sign up for the trial today?",
        a: "Not yet. The trial is a development hypothesis, not a public offer. This internal preview explains the planned trial without accepting registrations. No interest signal is recorded, and availability opens only after owner approval.",
      },
      {
        q: "How much does MPG Reputation cost?",
        a: "Pricing has not been set or published. Monthly, Yearly and Premium are proposed plan categories only. Final prices, paid-plan allowances and Premium benefits are not approved; checkout and live billing remain disabled.",
      },
    ],
  },
  {
    id: "setup",
    title: "Setup & fit",
    faqs: [
      {
        q: "Do I need Jobber, Housecall Pro or similar software?",
        a: "No. Quick Complete exists precisely for businesses without customer-management software: finish the job, tap once, done. If you do run such tools, the signed completion API/webhook is the intended connection path.",
      },
      {
        q: "How long does setup take?",
        a: "The core setup is: business details, your locations, your review destination link per location, and messaging rules. No data migration, no integrations required to start with Quick Complete.",
      },
      {
        q: "What data does the system store about my customers?",
        a: "The minimum the job requires: a completion signal and a contact for the request. Suppressed contacts are stored as hashes. There is no marketing database, no enrichment, no resale — and on this staging site, no visitor contact collection either.",
      },
    ],
  },
];

function FaqItem({
  faq,
  open,
  onToggle,
  idBase,
}: {
  faq: Faq;
  open: boolean;
  onToggle: () => void;
  idBase: string;
}) {
  return (
    <div className="surface-card overflow-hidden">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${idBase}-panel`}
          id={`${idBase}-button`}
          className="flex min-h-[56px] w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <span className="text-[15px] font-semibold text-ink">{faq.q}</span>
          {open ? (
            <Minus className="h-4 w-4 shrink-0 text-ember" aria-hidden />
          ) : (
            <Plus className="h-4 w-4 shrink-0 text-ink-mute" aria-hidden />
          )}
        </button>
      </h3>
      <div
        id={`${idBase}-panel`}
        role="region"
        aria-labelledby={`${idBase}-button`}
        hidden={!open}
        className="border-t border-line px-5 py-4"
      >
        <p className="text-[14px] leading-relaxed text-ink-soft">{faq.a}</p>
      </div>
    </div>
  );
}

export default function Faq() {
  useSeo(
    "FAQ",
    "Straight answers about MPG Reputation: what it does, review ethics, the 30 Free Review Requests trial concept, pricing status, setup and data handling.",
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [ctaOpen, setCtaOpen] = useState(false);

  useEffect(() => {
    track(FunnelEvents.faqOpened);
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <Section className="border-b border-line">
          <div className="max-w-3xl">
            <Reveal>
              <p className="kicker text-ember">FAQ</p>
              <h1 className="mt-4 font-display text-[clamp(2rem,4.4vw,3.2rem)] font-bold leading-[1.08] text-ink">
                Questions business owners actually ask.
              </h1>
              <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
                Answered the way we&apos;d want them answered if we were the ones
                evaluating: plainly, including the parts where the honest answer
                is “not yet.”
              </p>
            </Reveal>
          </div>
        </Section>

        {CATEGORIES.map((cat) => (
          <Section key={cat.id} className="border-b border-line last:border-b-0">
            <div className="mx-auto max-w-3xl">
              <Reveal>
                <h2 className="kicker text-ink">{cat.title}</h2>
              </Reveal>
              <div className="mt-6 space-y-3">
                {cat.faqs.map((f, j) => {
                  const key = `${cat.id}-${j}`;
                  return (
                    <Reveal key={key} delay={j * 50}>
                      <FaqItem
                        faq={f}
                        idBase={key}
                        open={openKey === key}
                        onToggle={() =>
                          setOpenKey((k) => (k === key ? null : key))
                        }
                      />
                    </Reveal>
                  );
                })}
              </div>
            </div>
          </Section>
        ))}

        <Section dark className="console-grid">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <h2 className="font-display text-[clamp(1.7rem,3.4vw,2.4rem)] font-bold text-console-ink">
                Still weighing it up? Start with your own numbers.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-console-mute">
                The free Reputation Check takes five minutes and shows where
                your current request process is leaking opportunities — no
                contact details required.
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/reputation-check"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-ember px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-ember-deep"
                >
                  Start the Free Check
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    track(FunnelEvents.trialDialogOpened, { source: "faq" });
                    setCtaOpen(true);
                  }}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-console-line bg-console-2 px-6 py-3 text-[15px] font-semibold text-console-ink transition-colors hover:border-console-mute"
                >
                  About the trial concept
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
        source="faq"
      />
    </div>
  );
}
