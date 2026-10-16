export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { DealerAccountPage } from "@/components/account/dealer-account-page";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Review dealer membership status and cancellation on itrader.im.",
};

export default async function DealerSubscriptionPage() {
  return DealerAccountPage({ section: "subscription", route: "/dealer/subscription" });
}
