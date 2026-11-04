import type { Metadata } from "next";
import ReputationReport from "@/components/marketing/ReputationReport";

export const metadata: Metadata = {
  title: 'Example Report | MPG Reputation',
  description: 'View a synthetic Reputation Opportunity Report example.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><ReputationReport /></div>;
}
