"use client";
import type { ReactNode } from "react";

interface ConsoleFrameProps {
  title: string;
  children: ReactNode;
  className?: string;
  /** show the synthetic-data disclosure tag */
  synthetic?: boolean;
}

/** Dark window chrome that frames every product mockup. */
export function ConsoleFrame({
  title,
  children,
  className = "",
  synthetic = true,
}: ConsoleFrameProps) {
  return (
    <div
      className={`console-panel overflow-hidden shadow-[0_24px_80px_-24px_rgba(20,18,12,0.45)] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-console-line px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-console-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-console-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-console-line" />
        </div>
        <p className="font-mono2 text-[10.5px] uppercase tracking-[0.14em] text-console-mute">
          {title}
        </p>
        {synthetic ? (
          <span className="rounded border border-console-line px-1.5 py-0.5 font-mono2 text-[9px] uppercase tracking-[0.12em] text-console-mute">
            Synthetic data
          </span>
        ) : (
          <span className="w-10" />
        )}
      </div>
      {children}
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "neutral";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    ok: "text-ok-bright border-ok-bright/30 bg-ok-bright/10",
    warn: "text-warn border-warn/30 bg-warn/10",
    bad: "text-bad border-bad/30 bg-bad/10",
    neutral: "text-console-mute border-console-line bg-console-3",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono2 text-[9.5px] font-medium uppercase tracking-[0.1em] ${tones[tone]}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
