import type { Metadata } from "next";
import Home from "@/components/marketing/Home";

export const metadata: Metadata = {
  title: 'MPG Reputation | Responsible Review Requests',
  description: 'Customer review-request automation for service businesses. Internal preview.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><Home /></div>;
}
