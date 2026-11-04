import type { Metadata } from "next";
import Pricing from "@/components/marketing/Pricing";

export const metadata: Metadata = {
  title: 'Pricing Preview | MPG Reputation',
  description: 'Monthly, yearly, and premium categories are being prepared. No public pricing or checkout.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <div className="mr9-site"><Pricing /></div>;
}
