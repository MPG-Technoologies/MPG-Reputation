"use client";
import { useEffect, useRef } from "react";
import { FlaskConical, X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
}
export function StagingCtaDialog({ open, onOpenChange }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []).filter((element) => element.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const outside = !dialogRef.current?.contains(document.activeElement);
        if (event.shiftKey && (outside || document.activeElement === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (outside || document.activeElement === last)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mr9-trial-title" aria-describedby="mr9-trial-detail"
        className="w-full max-w-md rounded-2xl border border-line bg-card p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <span className="kicker inline-flex items-center gap-2 text-ember"><FlaskConical className="h-4 w-4" aria-hidden /> Internal preview</span>
          <button ref={closeRef} type="button" aria-label="Close dialog" onClick={() => onOpenChange(false)} className="rounded-md p-2 text-ink-mute hover:text-ink focus-visible:outline-2"><X className="h-5 w-5" /></button>
        </div>
        <h2 id="mr9-trial-title" className="mt-5 font-display text-2xl font-bold text-ink">Trial access is not publicly available yet</h2>
        <p id="mr9-trial-detail" className="mt-4 text-[14px] leading-relaxed text-ink-soft">
          MPG Reputation is preparing a <strong>30 Free Review Requests</strong> trial concept. This is an internal website preview. No pricing, checkout, live trial signup or customer messaging is enabled.
        </p>
        <p className="mt-3 text-[13px] text-ink-mute">This dialog does not collect, transmit or save interest signals or contact details.</p>
        <button type="button" onClick={() => onOpenChange(false)} className="mt-6 min-h-[44px] w-full rounded-lg bg-ink px-4 py-2.5 font-semibold text-cream hover:bg-ember">Close preview</button>
      </section>
    </div>
  );
}
