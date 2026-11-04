"use client";
import { Check, Plus, Webhook, MousePointerClick } from "lucide-react";
import { ConsoleFrame, StatusPill } from "./ConsoleFrame";

/**
 * Quick Complete: the no-integration completion source.
 * One tap marks a job done; the automation takes it from there.
 */
export function QuickCompleteMock() {
  const jobs = [
    { name: "Furnace install — Alvarez", done: true },
    { name: "AC service — Whitfield", done: true },
    { name: "Thermostat replace — Nguyen", done: false },
  ];
  return (
    <ConsoleFrame title="Quick Complete" className="w-full">
      <div className="p-4 sm:p-5">
        <p className="font-mono2 text-[9.5px] uppercase tracking-[0.12em] text-console-mute">
          Today&apos;s completed work
        </p>
        <div className="mt-3 space-y-2">
          {jobs.map((j) => (
            <div
              key={j.name}
              className="console-card flex items-center gap-3 px-3 py-2.5"
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
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md bg-ember px-2.5 py-1.5 font-mono2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-ember-deep"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Complete
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-console-mute">
          No integration required — completion is the only signal the system
          needs.
        </p>
      </div>
    </ConsoleFrame>
  );
}

/** Universal completion API / webhook card. */
export function ApiSourceMock() {
  return (
    <ConsoleFrame title="Universal Completion API" className="w-full">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-ember" aria-hidden />
            <p className="text-[12.5px] font-medium text-console-ink">
              job.completed
            </p>
          </div>
          <StatusPill tone="ok">Listening</StatusPill>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-console-line bg-console p-3 font-mono2 text-[11px] leading-relaxed text-console-mute">
{`POST /v1/completions
{
  "job_id": "job_8f42",
  "customer": { "email": "m***@…" },
  "completed_at": "…"
}`}
        </pre>
        <p className="mt-3 text-[11px] leading-relaxed text-console-mute">
          One event shape, any tool that can send a webhook. Native
          integrations are added only where pilot evidence supports them.
        </p>
      </div>
    </ConsoleFrame>
  );
}

/** Automation health: routine automated, exceptions surfaced. */
export function HealthMock() {
  const rows = [
    { label: "Completion signals", state: "ok" as const, note: "Flowing" },
    { label: "Email delivery", state: "warn" as const, note: "1 retry queued" },
    { label: "Review destination", state: "ok" as const, note: "Link verified" },
    { label: "Suppression rules", state: "ok" as const, note: "Active" },
  ];
  return (
    <ConsoleFrame title="Automation Health" className="w-full">
      <div className="divide-y divide-console-line">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
          >
            <span className="text-[12.5px] text-console-ink">{r.label}</span>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-console-mute">{r.note}</span>
              <StatusPill tone={r.state}>
                {r.state === "ok" ? "Automated" : "Exception"}
              </StatusPill>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-console-line bg-console-2 px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2 text-[11.5px] text-console-mute">
          <MousePointerClick className="h-3.5 w-3.5 text-ember" aria-hidden />
          Automate the normal. Surface the exception.
        </p>
      </div>
    </ConsoleFrame>
  );
}
