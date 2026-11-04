"use client";
import {
  CheckCircle2,
  AlertTriangle,
  Send,
  MousePointerClick,
  Zap,
  CircleCheck,
} from "lucide-react";
import { ConsoleFrame, StatusPill } from "./ConsoleFrame";

const ACTIVITY = [
  {
    icon: Zap,
    iconTone: "text-ember",
    title: "Completion received",
    detail: "Furnace install — M. Alvarez · via Quick Complete",
    time: "2m",
  },
  {
    icon: CheckCircle2,
    iconTone: "text-ok-bright",
    title: "Eligibility passed",
    detail: "No suppression · first request this job",
    time: "2m",
  },
  {
    icon: Send,
    iconTone: "text-ok-bright",
    title: "Review request sent",
    detail: "Email → customer · neutral template EN",
    time: "2m",
  },
  {
    icon: MousePointerClick,
    iconTone: "text-ok-bright",
    title: "Customer opened review link",
    detail: "Destination: Google Business Profile",
    time: "38m",
  },
  {
    icon: AlertTriangle,
    iconTone: "text-warn",
    title: "Delivery exception",
    detail: "Mailbox full — queued for retry · surfaced to ops",
    time: "1h",
  },
];

export function DashboardMock() {
  return (
    <ConsoleFrame title="MPG Reputation · Activity" className="w-full">
      <div className="grid gap-3 p-4 sm:p-5">
        {/* top stat row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Requests sent", value: "18", sub: "this trial period" },
            { label: "Delivered", value: "17", sub: "1 retry queued" },
            { label: "Exceptions", value: "1", sub: "needs attention" },
          ].map((s) => (
            <div key={s.label} className="console-card p-3 sm:p-4">
              <p className="font-mono2 text-[9.5px] uppercase tracking-[0.12em] text-console-mute">
                {s.label}
              </p>
              <p className="mt-1.5 font-display text-2xl font-bold text-console-ink sm:text-3xl">
                {s.value}
              </p>
              <p className="mt-0.5 text-[11px] text-console-mute">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* trial usage */}
        <div className="console-card p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono2 text-[9.5px] uppercase tracking-[0.12em] text-console-mute">
              Trial usage · 30 Free Review Requests
            </p>
            <StatusPill tone="ok">Active</StatusPill>
          </div>
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-console-line"
            role="progressbar"
            aria-valuenow={18}
            aria-valuemin={0}
            aria-valuemax={30}
            aria-label="Trial usage: 18 of 30 review requests"
          >
            <div className="h-full w-[60%] rounded-full bg-ember" />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-console-mute">
            <span>18 used</span>
            <span>12 remaining · or 21 days, whichever first</span>
          </div>
        </div>

        {/* activity feed */}
        <div className="console-card divide-y divide-console-line">
          {ACTIVITY.map((a) => (
            <div key={a.title + a.time} className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
              <a.icon
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${a.iconTone}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-console-ink">
                  {a.title}
                </p>
                <p className="truncate text-[11.5px] text-console-mute">
                  {a.detail}
                </p>
              </div>
              <span className="shrink-0 font-mono2 text-[10px] text-console-mute">
                {a.time}
              </span>
            </div>
          ))}
        </div>

        {/* health strip */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="ok">
            <CircleCheck className="h-2.5 w-2.5" aria-hidden /> Review destination valid
          </StatusPill>
          <StatusPill tone="ok">Suppression list active</StatusPill>
          <StatusPill tone="warn">1 messaging exception</StatusPill>
        </div>
      </div>
    </ConsoleFrame>
  );
}
