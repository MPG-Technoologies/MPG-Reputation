"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { Logo } from "./Logo";

const NAV_ITEMS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/reputation-check", label: "Free Reputation Check" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors ${pathname === item.href ? "bg-cream text-ink" : "text-ink-mute hover:text-ink"}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="inline-flex min-h-[44px] items-center px-2 text-[13.5px] font-medium text-ink-mute hover:text-ink">Sign In</Link>
          <Link href="/reputation-check" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-ember">
            Free Reputation Check <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <button type="button" aria-expanded={open} aria-controls="mr9-mobile-menu" aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink lg:hidden">
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>
      {open && (
        <nav id="mr9-mobile-menu" aria-label="Mobile" className="border-t border-line bg-paper px-5 pb-6 pt-2 lg:hidden">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`block min-h-[44px] rounded-lg px-3 py-3 text-[15px] font-medium ${pathname === item.href ? "bg-cream text-ink" : "text-ink-soft hover:text-ink"}`}>
              {item.label}
            </Link>
          ))}
          <div className="mt-3 border-t border-line pt-4">
            <Link href="/login" onClick={() => setOpen(false)} className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-line px-4 py-2.5 text-[14px] font-medium text-ink">Sign In</Link>
          </div>
        </nav>
      )}
    </header>
  );
}
