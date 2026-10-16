export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { DealerAccountPage, type DealerListingQuery } from "@/components/account/dealer-account-page";

export const metadata: Metadata = {
  title: "Listings",
  description: "Filter and manage dealer listings on itrader.im.",
};

interface Props {
  searchParams?: Promise<DealerListingQuery>;
}

export default async function DealerListingsPage({ searchParams }: Props) {
  return DealerAccountPage({ section: "listings", route: "/dealer/listings", searchParams });
}
