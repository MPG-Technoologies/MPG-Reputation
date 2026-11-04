import type { Metadata } from "next";
import Trust from "@/components/marketing/Trust";

export const metadata: Metadata = {
  title: 'Trust & Integrity | MPG Reputation',
  description: 'Learn about responsible review-request practices and technical safeguards.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><Trust /></div>;
}
