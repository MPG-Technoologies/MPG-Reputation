import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "MPG Reputation",
  title: "MPG Reputation | Internal Preview",
  description:
    "Prelaunch preview of MPG Reputation's responsible review-request workflows and product experience.",
  // Root-level fail-closed default for every page without route metadata.
  // Page-level preview rules remain in place until a separately approved launch.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
