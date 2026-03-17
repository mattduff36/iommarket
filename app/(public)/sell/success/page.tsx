export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Payment Successful",
};

interface Props {
  searchParams: Promise<{
    listing?: string;
    flow?: "private" | "dealer";
    payment?: "paid" | "skipped" | "support";
  }>;
}

export default async function SellSuccessPage({ searchParams }: Props) {
  const sp = await searchParams;
  const listingId = sp.listing;
  const payment = sp.payment ?? "paid";
  const nextSellUrl =
    sp.flow === "dealer"
      ? "/sell/dealer"
      : sp.flow === "private"
        ? "/sell/private"
        : "/sell";
  const title =
    payment === "skipped"
      ? "Listing Submitted"
      : payment === "support"
        ? "Thank You for Supporting itrader.im"
        : "Payment Successful";
  const message =
    payment === "skipped"
      ? "Your listing has been submitted for review. Our moderation team will check it within 1-2 business days."
      : payment === "support"
        ? "Your optional support payment was successful. Your listing has been submitted for review."
        : "Your listing payment was successful and your listing has been submitted for review. Our moderation team will check it within 1-2 business days.";

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8 text-center">
      <Card>
        <CardHeader className="items-center">
          <CheckCircle className="h-12 w-12 text-emerald-500 mb-2" />
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-secondary">{message}</p>
          <div className="flex flex-col gap-2">
            {listingId && (
              <Button asChild>
                <Link href={`/listings/${listingId}`}>View Listing</Link>
              </Button>
            )}
            <Button asChild variant="trust">
              <Link href={nextSellUrl}>Create Another Listing</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/">Back to Home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
