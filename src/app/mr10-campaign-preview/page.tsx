import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CAMPAIGN_BRIEFS } from "@/components/marketing/campaign-briefs";
import {
  SAMPLE_EDITORIAL_CALENDAR,
  REVIEW_CHECKPOINT_LABELS,
} from "@/components/marketing/editorial-calendar";
import { CampaignWorkspace } from "@/components/marketing/CampaignWorkspace";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";

/** Never create a publicly accessible campaign management or lead capture page. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Campaign Drafts | MPG Reputation",
  description: "Local-only internal marketing copy previews.",
  robots: { index: false, follow: false, nocache: true },
};

export default function CampaignPreviewPage() {
  // In preview/production builds, this route returns 404 regardless of URL.
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <div className="mr9-site min-h-screen bg-paper">
      <SiteNav />
      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="max-w-3xl">
          <p className="kicker text-ember">MR-10F · Development-only preview</p>
          <h1 className="mt-4 font-display text-3xl font-bold text-ink sm:text-4xl">
            Marketing campaign drafts
          </h1>
          <p className="mt-5 text-base leading-8 text-ink-soft">
            These examples introduce verified MPG Reputation workflows. They
            are editorial drafts, not active campaigns, customer endorsements,
            a marketing inbox, or approved commercial offers.
          </p>
          <p className="mt-4 rounded-lg border border-line bg-card p-4 text-sm text-ink-mute">
            No campaigns are sent or scheduled. No real visitors are tracked,
            no leads are collected, and no billing or messaging is enabled.
            This route is unavailable outside local development.
          </p>
        </div>

        <CampaignWorkspace />

        <section aria-labelledby="mr10-campaign-cards" className="mt-12">
          <h2 id="mr10-campaign-cards" className="text-xl font-semibold text-ink">
            Reference campaign briefs
          </h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {CAMPAIGN_BRIEFS.map((brief) => (
              <article key={brief.id} className="surface-card flex flex-col p-6 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="kicker text-ember">{brief.creative.eyebrow}</span>
                  <span className="rounded-md border border-line px-2 py-1 text-xs text-ink-mute">
                    Draft only
                  </span>
                </div>
                <h3 className="mt-4 font-display text-2xl font-semibold text-ink">
                  {brief.creative.headline}
                </h3>
                <p className="mt-4 flex-1 leading-7 text-ink-soft">
                  {brief.creative.explanation}
                </p>
                <div className="mt-6 border-t border-line pt-5">
                  <p className="text-xs text-ink-mute">
                    Intended stage: {brief.stage} · Proposed surfaces:
                    {" "}{brief.surfaces.join(", ")}
                  </p>
                  <Link
                    href={brief.creative.ctaHref}
                    className="mt-4 inline-flex min-h-11 items-center rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-ember hover:border-ember focus-visible:outline focus-visible:outline-2"
                  >
                    Preview destination: {brief.creative.ctaLabel}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="mr10-editorial-calendar" className="mt-14">
          <h2 id="mr10-editorial-calendar" className="text-xl font-semibold text-ink">
            Example editorial calendar
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-ink-soft">
            These are fictional planning placements. Dates are illustrative,
            not publication deadlines, scheduled jobs, or approved campaigns.
          </p>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {SAMPLE_EDITORIAL_CALENDAR.map((slot) => {
              const brief = CAMPAIGN_BRIEFS.find((item) => item.id === slot.campaignId);
              return (
                <li key={slot.id} className="surface-card flex flex-col p-5">
                  <p className="kicker text-ember">Sample date · {slot.proposedDate}</p>
                  <h3 className="mt-3 font-display text-lg font-semibold text-ink">
                    {brief?.creative.headline ?? "Unlinked draft"}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-6 text-ink-soft">
                    Draft surface: {slot.surface}
                  </p>
                  <p className="mt-5 border-t border-line pt-4 text-xs text-ink-mute">
                    Example review checkpoint: {REVIEW_CHECKPOINT_LABELS[slot.checkpoint]}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-ember">
                    Sample only · never scheduled
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="mr10-review-gates" className="mt-12 rounded-xl border border-line bg-card p-6">
          <h2 id="mr10-review-gates" className="text-xl font-semibold text-ink">
            Publication and activation gates remain closed
          </h2>
          <p className="mt-4 leading-7 text-ink-soft">
            Campaign copy needs owner approval and any applicable legal,
            privacy, channel-provider, operational and commercial review.
            The 30 Free Review Requests concept is not a guarantee of
            published reviews or immediate public trial access.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
