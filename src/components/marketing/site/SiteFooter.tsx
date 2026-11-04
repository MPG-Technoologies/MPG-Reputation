"use client";
import Link from "next/link";
import { Logo } from "./Logo";

const COLUMNS: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { to: "/features", label: "Features" },
      { to: "/how-it-works", label: "How It Works" },
      { to: "/pricing", label: "Pricing" },
      { to: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Get Started",
    links: [
      { to: "/reputation-check", label: "Free Reputation Check" },
      { to: "/reputation-report", label: "Example Report" },
      { to: "/login", label: "Sign In" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/trust", label: "Security & Trust" },
      { to: "/trust#integrity", label: "Review Integrity" },
      { to: "/resources", label: "Resources" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-cream">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-ink-mute">
              MPG Reputation helps businesses turn completed customer work into
              a consistent, neutral review-request process.
            </p>
            <p className="mt-5 kicker text-ink-mute">
              A product of MPG · Staging environment
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="kicker text-ink">{col.title}</h3>
              <ul className="mt-4 space-y-1">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.to}
                      className="inline-flex min-h-[36px] items-center text-[13.5px] text-ink-mute transition-colors hover:text-ink"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-[12.5px] text-ink-mute sm:flex-row sm:items-center sm:justify-between">
          <p>
            Staging design environment — no commercial availability, pricing, or
            customer results are represented.
          </p>
          <p className="font-mono2">v0.9-staging</p>
        </div>
      </div>
    </footer>
  );
}
