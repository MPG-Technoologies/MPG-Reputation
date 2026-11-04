import type { Metadata } from "next";
import Faq from "@/components/marketing/Faq";

export const metadata: Metadata = {
  title: 'Questions & Answers | MPG Reputation',
  description: 'Learn about review requests, customer choice, usage, and trial availability.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><Faq /></div>;
}
