"use client";
import { useState, type ComponentType } from "react";
import {
  ClipboardCheck,
  Send,
  MousePointerClick,
  Activity,
  Check,
} from "lucide-react";
import { ConsoleFrame, StatusPill } from "./ConsoleFrame";
import { EmailMock } from "./EmailMock";
import { track, FunnelEvents } from "@/components/marketing/funnel";

const DEMO_STEPS = [
  {
    id: "complete",
    icon: ClipboardCheck,
    label: "Complete the work",
    title: "Mark the job done — that's the whole job of the owner",
    text: "After a real service is finished, the owner taps Quick Complete (or their existing tool fires the completion webhook). Nothing else to remember, nothing else to schedule.",
  },
  {
    id: "request",
    icon: Send,
    label: "The request goes out",
    title: "Rules decide, the system sends",
    text: "Eligibility, suppression and frequency rules are evaluated first. Only then does a neutral, recognizable email go out — identical wording for every eligible customer.",
  },
  {
    id: "customer",
    icon: MousePointerClick,
    label: "The customer chooses",
    title: "One email, one button, one destination",
    text: "The customer taps a single CTA and lands on the business's review destination. No MPG account, no app, no detours. Whether they write anything — and what they write — is entirely their choice.",
  },
  {
    id: "activity",
    icon: Activity,
    label: "The business watches",
    title: "Every step leaves a trace",
    text: "Sends, deliveries, clicks on the tracked review link, failures and suppressions — all visible in one activity feed. Exceptions surface; the routine stays silent.",
  },
] as const;

function QuickCompleteStep() {
  return (
    <ConsoleFrame title="Quick Complete" className="w-full">
      <div className="p-5">
        <p className="font-mono2 text-[9.5px] uppercase tracking-[0.12em] text-console-mute">
          Today&apos;s completed work
        </p>
        <div className="mt-3 space-y-2">
          {[
            { name: "Brake service — T. Okafor", done: true },
            { name: "Oil change — R. Simmons", done: false },
          ].map((j) => (
            <div
              key={j.name}
              className="console-card flex items-center gap-3 px-3 py-3"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  j.done
                    ? "border-ok-bright/40 bg-ok-bright/15 text-ok-bright"
                    : "border-console-line text-console-mute"
                }`}
              >
                {j.done && <Check className="h-3.5 w-3.5" aria-hidden />}
              </span>
              <span
                className={`flex-1 truncate text-[12.5px] ${
                  j.done ? "text-console-ink" : "text-console-mute"
                }`}
              >
                {j.name}
              </span>
              {j.done ? (
                <StatusPill tone="ok">Request queued</StatusPill>
              ) : (
                <span className="inline-flex min-h-[36px] items-center rounded-md bg-ember px-3 py-1.5 font-mono2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                  Complete
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </ConsoleFrame>
  );
}

function RequestStep() {
  const rows = [
    { k: "Eligibility", v: "Passed — first request for this job", ok: true },
    { k: "Suppression", v: "Contact not suppressed", ok: true },
    { k: "Frequency cap", v: "Within limit", ok: true },
    { k: "Template", v: "Neutral request · EN", ok: true },
  ];
  return (
    <ConsoleFrame title="Review Request Automation" className="w-full">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono2 text-[9.5px] uppercase tracking-[0.12em] text-console-mute">
            Pre-send evaluation
          </p>
          <StatusPill tone="ok">Send approved</StatusPill>
        </div>
        <div className="mt-3 divide-y divide-console-line rounded-lg border border-console-line">
          {rows.map((r) => (
            <div
              key={r.k}
              className="flex items-center justify-between px-3.5 py-2.5"
            >
              <span className="text-[12px] font-medium text-console-ink">
                {r.k}
              </span>
              <span className="text-[11px] text-console-mute">{r.v}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-console-mute">
          If any rule fails, no request is sent — and the decision is recorded.
        </p>
      </div>
    </ConsoleFrame>
  );
}

function ActivityStep() {
  const events = [
    { t: "Request sent", d: "Email → customer", tone: "ok" as const },
    { t: "Delivered", d: "Provider confirmed delivery", tone: "ok" as const },
    { t: "Review link opened", d: "Tracked destination link clicked", tone: "ok" as const },
    { t: "Reminder eligible", d: "Bounded follow-up available after 3 days", tone: "neutral" as const },
  ];
  return (
    <ConsoleFrame title="Request Activity" className="w-full">
      <div className="divide-y divide-console-line">
        {events.map((e) => (
          <div key={e.t} className="flex items-start gap-3 px-5 py-3">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                e.tone === "ok" ? "bg-ok-bright" : "bg-console-mute"
              }`}
              aria-hidden
            />
            <div>
              <p className="text-[12.5px] font-medium text-console-ink">
                {e.t}
              </p>
              <p className="text-[11px] text-console-mute">{e.d}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-console-line bg-console-2 px-5 py-3">
        <p className="text-[11px] leading-relaxed text-console-mute">
          A click is evidence of interest — not proof a review was published.
        </p>
      </div>
    </ConsoleFrame>
  );
}

const STEP_PANELS: Record<string, ComponentType> = {
  complete: QuickCompleteStep,
  request: RequestStep,
  customer: () => <EmailMock />,
  activity: ActivityStep,
};

/** Interactive product demonstration: step through the owner's journey. */
export function DemoWalkthrough() {
  const [active, setActive] = useState(0);
  const Panel = STEP_PANELS[DEMO_STEPS[active].id];

  function goTo(i: number) {
    setActive(i);
    track(FunnelEvents.demoStepViewed, { step: DEMO_STEPS[i].id });
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product demonstration steps"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {DEMO_STEPS.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            id={`demo-tab-${s.id}`}
            aria-selected={active === i}
            aria-controls={`demo-panel-${s.id}`}
            onClick={() => goTo(i)}
            className={`flex min-h-[64px] flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors ${
              active === i
                ? "border-ember bg-card"
                : "border-line bg-cream hover:border-ink-mute"
            }`}
          >
            <span className="flex items-center gap-2">
              <s.icon
                className={`h-4 w-4 ${active === i ? "text-ember" : "text-ink-mute"}`}
                aria-hidden
              />
              <span className="font-mono2 text-[9px] uppercase tracking-[0.12em] text-ink-mute">
                {String(i + 1).padStart(2, "0")}
              </span>
            </span>
            <span
              className={`text-[12.5px] font-semibold leading-tight ${
                active === i ? "text-ink" : "text-ink-soft"
              }`}
            >
              {s.label}
            </span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`demo-panel-${DEMO_STEPS[active].id}`}
        aria-labelledby={`demo-tab-${DEMO_STEPS[active].id}`}
        className="mt-6 grid items-center gap-8 lg:grid-cols-[0.85fr_1.15fr]"
      >
        <div>
          <h3 className="font-display text-xl font-bold text-ink sm:text-2xl">
            {DEMO_STEPS[active].title}
          </h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
            {DEMO_STEPS[active].text}
          </p>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              disabled={active === 0}
              onClick={() => goTo(Math.max(0, active - 1))}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-card px-4 text-[13px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={active === DEMO_STEPS.length - 1}
              onClick={() => goTo(Math.min(DEMO_STEPS.length - 1, active + 1))}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-ink px-4 text-[13px] font-semibold text-cream transition-colors hover:bg-ember disabled:opacity-40"
            >
              Next step
            </button>
          </div>
        </div>
        <div key={DEMO_STEPS[active].id} className="reveal is-visible">
          <Panel />
        </div>
      </div>
    </div>
  );
}
