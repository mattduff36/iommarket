export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { DealerAccountPage } from "@/components/account/dealer-account-page";

export const metadata: Metadata = {
  title: "Reviews",
  description: "Respond to approved dealer reviews on itrader.im.",
};

export default async function DealerReviewsPage() {
  return DealerAccountPage({ section: "reviews", route: "/dealer/reviews" });
}
