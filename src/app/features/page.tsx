import type { Metadata } from "next";
import Features from "@/components/marketing/Features";

export const metadata: Metadata = {
  title: 'Features | MPG Reputation',
  description: 'See the verified MPG Reputation completion, review-request, and activity workflows.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><Features /></div>;
}
