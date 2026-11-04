import type { Metadata } from "next";
import ReputationCheck from "@/components/marketing/ReputationCheck";

export const metadata: Metadata = {
  title: 'Free Reputation Check | MPG Reputation',
  description: 'Private browser-only assessment. No responses are stored or sent.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><ReputationCheck /></div>;
}
