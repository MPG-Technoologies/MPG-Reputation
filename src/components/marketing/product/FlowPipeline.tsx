"use client";
import {
  ClipboardCheck,
  Radio,
  ShieldCheck,
  Send,
  MousePointerClick,
  Activity,
} from "lucide-react";
import { Reveal } from "../site/Reveal";

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "Work is completed",
    text: "A real job, appointment, or project finishes — in the field, in your existing tools.",
  },
  {
    icon: Radio,
    title: "Signal received",
    text: "MPG Reputation gets the completion via Quick Complete or the universal API/webhook.",
  },
  {
    icon: ShieldCheck,
    title: "Rules are checked",
    text: "Eligibility, permission, suppression and frequency rules decide whether a request is appropriate.",
  },
  {
    icon: Send,
    title: "Request is sent",
    text: "A neutral, recognizable request goes out — same wording for every eligible customer.",
  },
  {
    icon: MousePointerClick,
    title: "One clear path",
    text: "The customer taps one CTA and lands on your review destination. No account, no app.",
  },
  {
    icon: Activity,
    title: "Activity is visible",
    text: "The business sees sends, delivery and exceptions — the routine stays automated.",
  },
];

/**
 * The core product truth, visualized: completed customer → eligibility →
 * request → CTA → trusted destination → operational visibility.
 */
export function FlowPipeline({ dark = false }: { dark?: boolean }) {
  return (
    <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {STEPS.map((s, i) => (
        <Reveal key={s.title} delay={i * 90}>
          <li
            className={`relative h-full rounded-xl border p-5 ${
              dark
                ? "border-console-line bg-console-3"
                : "border-line bg-card"
            }`}
          >
            <div className="flex items-center justify-between">
              <s.icon
                className={`h-5 w-5 ${dark ? "text-ember" : "text-ember"}`}
                aria-hidden
              />
              <span
                className={`font-mono2 text-[10px] uppercase tracking-[0.14em] ${
                  dark ? "text-console-mute" : "text-ink-mute"
                }`}
              >
                Step {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <h3
              className={`mt-4 font-display text-[16px] font-semibold ${
                dark ? "text-console-ink" : "text-ink"
              }`}
            >
              {s.title}
            </h3>
            <p
              className={`mt-1.5 text-[13px] leading-relaxed ${
                dark ? "text-console-mute" : "text-ink-mute"
              }`}
            >
              {s.text}
            </p>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}
