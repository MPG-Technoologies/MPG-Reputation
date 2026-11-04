"use client";

import Link from "next/link";
import { useState } from "react";
import { CAMPAIGN_BRIEFS } from "./campaign-briefs";
import { REVIEW_CHECKPOINT_LABELS } from "./editorial-calendar";
import {
  countPreparedReviewEvidence,
  type EvidencePrepGateId,
} from "./publication-readiness";
import { buildMarketingWorkspaceSnapshot } from "./workspace-model";

/**
 * Internal, development-route-only preview. Its checkboxes are disposable
 * local React state and are NOT evidence, approval, or publication controls.
 */
export function CampaignWorkspace() {
  const [campaignId, setCampaignId] = useState(CAMPAIGN_BRIEFS[0].id);
  const [preparedEvidence, setPreparedEvidence] = useState<
    readonly EvidencePrepGateId[]
  >([]);

  const { campaign, placements, review } = buildMarketingWorkspaceSnapshot(
    campaignId,
    preparedEvidence,
  );
  const count = countPreparedReviewEvidence(review);

  function selectCampaign(id: string) {
    setCampaignId(id);
    setPreparedEvidence([]);
  }

  function setExampleEvidence(id: EvidencePrepGateId, checked: boolean) {
    setPreparedEvidence((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((entry) => entry !== id);
    });
  }

  return (
    <section
      aria-labelledby="mr10-integrated-workspace"
      className="mt-12 rounded-xl border border-line bg-card p-5 sm:p-8"
    >
      <div className="max-w-3xl">
        <p className="kicker text-ember">MR-10F · Browser-memory simulation</p>
        <h2 id="mr10-integrated-workspace" className="mt-3 font-display text-2xl font-semibold text-ink sm:text-3xl">
          Connected campaign review workspace
        </h2>
        <p className="mt-3 text-sm leading-7 text-ink-soft">
          Select a draft to inspect its proposed calendar placement and seven
          review requirements. Checking a box means only that a fictional
          evidence item is prepared for review. Nothing is saved, approved,
          scheduled, published or sent. Reloading clears all selections.
        </p>
      </div>

      <div role="group" aria-label="Select an example campaign" className="mt-7 flex flex-wrap gap-3">
        {CAMPAIGN_BRIEFS.map((brief) => (
          <button
            key={brief.id}
            type="button"
            aria-pressed={campaignId === brief.id}
            onClick={() => selectCampaign(brief.id)}
            className={
              "min-h-11 rounded-md border px-4 py-2 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 " +
              (campaignId === brief.id
                ? "border-ember bg-paper text-ember"
                : "border-line bg-card text-ink-soft hover:border-ember")
            }
          >
            {brief.creative.eyebrow}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="mr10-selected-draft" className="rounded-lg border border-line bg-paper p-5 sm:p-6">
          <p className="kicker text-ember">Stage 1 · Select a draft</p>
          <h3 id="mr10-selected-draft" className="mt-3 font-display text-xl font-semibold text-ink">
            {campaign.creative.headline}
          </h3>
          <p className="mt-3 text-sm leading-7 text-ink-soft">
            {campaign.creative.explanation}
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-ink">Audience</dt>
              <dd className="mt-1 text-ink-soft">{campaign.audience}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Educational objective</dt>
              <dd className="mt-1 text-ink-soft">{campaign.objective}</dd>
            </div>
          </dl>
          <Link
            href={campaign.creative.ctaHref}
            className="mt-5 inline-flex min-h-11 items-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-ember hover:border-ember focus-visible:outline focus-visible:outline-2"
          >
            Preview destination: {campaign.creative.ctaLabel}
          </Link>

          <div className="mt-8 border-t border-line pt-5">
            <h4 className="font-semibold text-ink">Stage 2 · Example calendar placements</h4>
            <p className="mt-2 text-xs leading-6 text-ink-mute">
              Dates below are fictional planning examples, never scheduled events.
            </p>
            <ul className="mt-4 space-y-3">
              {placements.map((placement) => (
                <li key={placement.id} className="rounded-md border border-line bg-card p-4">
                  <p className="text-sm font-semibold text-ink">
                    Sample date · {placement.proposedDate}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {placement.surface} · {REVIEW_CHECKPOINT_LABELS[placement.checkpoint]}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-7 border-t border-line pt-5">
            <h4 className="font-semibold text-ink">Draft-specific review notes</h4>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-ink-soft">
              {campaign.reviewNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="mr10-readiness-checklist" className="rounded-lg border border-line bg-paper p-5 sm:p-6">
          <p className="kicker text-ember">Stage 3 · Evidence preparation only</p>
          <h3 id="mr10-readiness-checklist" className="mt-3 font-display text-xl font-semibold text-ink">
            Publication-readiness requirements
          </h3>
          <p aria-live="polite" className="mt-3 text-sm font-semibold text-ink">
            Example evidence prepared: {count} of {review.reviewItems.length - 1}
          </p>
          <p className="mt-1 text-xs leading-6 text-ink-mute">
            These controls simulate draft preparation, not validation or approval.
          </p>
          <ul className="mt-5 space-y-4">
            {review.reviewItems.map((item) => {
              if (item.id === "owner-publication-decision") {
                return (
                  <li key={item.id} className="rounded-lg border border-line bg-card p-4">
                    <p className="font-semibold text-ink">Stage 4 · {item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">{item.requirement}</p>
                    <p className="mt-2 text-xs font-semibold text-ember">
                      Locked · Separate owner publication decision required
                    </p>
                  </li>
                );
              }
              const gateId: EvidencePrepGateId = item.id;
              return (
                <li key={item.id} className="rounded-lg border border-line bg-card p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-ember"
                      checked={preparedEvidence.includes(gateId)}
                      onChange={(event) => setExampleEvidence(gateId, event.target.checked)}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{item.title}</span>
                      <span className="mt-1 block text-xs leading-6 text-ink-soft">
                        {item.requirement}
                      </span>
                      <span className="mt-2 block text-xs font-semibold text-ember">
                        {item.status === "EVIDENCE_DRAFTED"
                          ? "Example evidence drafted · not approved"
                          : "Not assessed in this example"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <p role="status" className="mt-6 rounded-lg border border-line bg-paper p-4 text-sm font-semibold text-ink">
        Publication blocked. Owner release approval is not recorded or available
        in this workspace, regardless of example checklist progress.
      </p>
    </section>
  );
}
