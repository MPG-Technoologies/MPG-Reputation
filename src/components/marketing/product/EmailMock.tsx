"use client";
import { Check, Star } from "lucide-react";

/**
 * The customer-facing experience: one clear, neutral email,
 * one CTA, straight to the review destination. Light surface —
 * this is what the *customer* sees, not the business console.
 */
export function EmailMock() {
  return (
    <div className="surface-card w-full overflow-hidden shadow-[0_20px_60px_-24px_rgba(20,18,12,0.25)]">
      <div className="border-b border-line bg-cream px-5 py-3">
        <p className="font-mono2 text-[10px] uppercase tracking-[0.12em] text-ink-mute">
          What your customer receives
        </p>
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink font-display text-[13px] font-bold text-cream">
            R
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-ink">
              Ridgeline Heating &amp; Air
            </p>
            <p className="text-[12px] text-ink-mute">
              A quick request about your recent service
            </p>
          </div>
        </div>

        <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
          Hi Maria — thanks for having us out for the furnace installation.
          If you have a moment, we&apos;d value your honest feedback, whatever
          your experience was.
        </p>

        <button
          type="button"
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-[13.5px] font-semibold text-cream transition-colors hover:bg-ember sm:w-auto"
        >
          <Star className="h-4 w-4" aria-hidden />
          Leave a Google review
        </button>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-mute">
          <span className="inline-flex items-center gap-1">
            <Check className="h-3 w-3 text-ok" aria-hidden /> No account needed
          </span>
          <span className="inline-flex items-center gap-1">
            <Check className="h-3 w-3 text-ok" aria-hidden /> No app to install
          </span>
          <span className="inline-flex items-center gap-1">
            <Check className="h-3 w-3 text-ok" aria-hidden /> Unsubscribe any time
          </span>
        </div>

        <p className="mt-4 border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink-mute">
          Synthetic example. Requests are neutral — every eligible customer
          receives the same wording, regardless of expected sentiment.
        </p>
      </div>
    </div>
  );
}
