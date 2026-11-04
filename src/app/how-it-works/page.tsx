import type { Metadata } from "next";
import HowItWorks from "@/components/marketing/HowItWorks";

export const metadata: Metadata = {
  title: 'How It Works | MPG Reputation',
  description: 'Explore the MPG Reputation business and customer journey.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><HowItWorks /></div>;
}
