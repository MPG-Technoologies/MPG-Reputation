"use client";
import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

interface SectionHeadingProps {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
  dark?: boolean;
}

export function SectionHeading({
  kicker,
  title,
  lede,
  align = "left",
  dark = false,
}: SectionHeadingProps) {
  const center = align === "center";
  return (
    <Reveal
      className={`max-w-3xl ${center ? "mx-auto text-center" : ""}`}
    >
      <p className={`kicker ${dark ? "text-ember" : "text-ember"}`}>{kicker}</p>
      <h2
        className={`mt-3 font-display text-[clamp(1.75rem,3.6vw,2.6rem)] font-bold leading-[1.12] ${
          dark ? "text-console-ink" : "text-ink"
        }`}
      >
        {title}
      </h2>
      {lede && (
        <p
          className={`mt-4 text-[16px] leading-relaxed ${
            dark ? "text-console-mute" : "text-ink-soft"
          }`}
        >
          {lede}
        </p>
      )}
    </Reveal>
  );
}

interface SectionProps {
  id?: string;
  children: ReactNode;
  className?: string;
  dark?: boolean;
}

export function Section({ id, children, className = "", dark }: SectionProps) {
  return (
    <section
      id={id}
      className={`${dark ? "bg-console text-console-ink" : ""} ${className}`}
    >
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:py-28">
        {children}
      </div>
    </section>
  );
}
