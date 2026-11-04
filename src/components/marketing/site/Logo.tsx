"use client";
import Link from "next/link";
import { MpgLogoIcon } from "@/components/ui/icons";

/** Shared MPG icon and wordmark, consistent with the existing application. */
export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="MPG Reputation home"
      className="group inline-flex min-h-[44px] items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    >
      <MpgLogoIcon className="h-8 w-8 shrink-0" aria-hidden="true" />
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-display text-[17px] font-bold tracking-tight text-ink">MPG</span>
        <span className={`text-[15px] font-semibold tracking-tight ${dark ? "text-console-ink" : "text-ink-soft"}`}>
          Reputation
        </span>
      </span>
    </Link>
  );
}
