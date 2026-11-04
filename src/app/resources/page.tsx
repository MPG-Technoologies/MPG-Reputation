import type { Metadata } from "next";
import Resources from "@/components/marketing/Resources";

export const metadata: Metadata = {
  title: 'Resources | MPG Reputation',
  description: 'Practical guidance on responsible review-request workflows.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><Resources /></div>;
}
