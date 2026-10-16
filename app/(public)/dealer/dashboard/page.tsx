export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import {
  DealerAccountPage,
  dealerListingsRedirectTarget,
  type DealerListingQuery,
} from "@/components/account/dealer-account-page";

export const metadata: Metadata = {
  title: "Dealer overview",
  description: "Review dealer inventory, membership, and Trade status on itrader.im.",
};

interface Props {
  searchParams?: Promise<DealerListingQuery>;
}

export default async function DealerDashboardPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  return DealerAccountPage({
    section: "overview",
    route: "/dealer/dashboard",
    redirectTo: dealerListingsRedirectTarget(params),
  });
}
