export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RetryCheckoutButton } from "./retry-checkout-button";

export const metadata: Metadata = {
  title: "Checkout Cancelled",
  description: "Resume checkout or return to your listing flow.",
};

interface Props {
  searchParams: Promise<{
    listing?: string;
    flow?: "private" | "dealer";
  }>;
}

export default async function SellCheckoutPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/sell");

  const sp = await searchParams;
  if (!sp.listing) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Checkout cancelled</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-secondary">
              Your checkout was cancelled before a listing was selected.
            </p>
            <Button asChild>
              <Link href="/sell">Back to Sell</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const listing = await db.listing.findUnique({
    where: { id: sp.listing },
    select: {
      id: true,
      title: true,
      userId: true,
      dealerId: true,
      status: true,
    },
  });

  if (!listing || listing.userId !== user.id) {
    redirect("/sell");
  }

  const flow = sp.flow ?? (listing.dealerId ? "dealer" : "private");

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <CardTitle>Checkout cancelled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-secondary">
            You cancelled checkout for <span className="font-medium text-text-primary">{listing.title}</span>.
          </p>

          {listing.status === "PENDING" ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                This listing is already submitted for moderation.
              </p>
              <Button asChild>
                <Link href={`/listings/${listing.id}`}>View listing</Link>
              </Button>
            </div>
          ) : (
            <RetryCheckoutButton listingId={listing.id} flow={flow} />
          )}

          <Button asChild variant="ghost">
            <Link href={flow === "dealer" ? "/sell/dealer" : "/sell/private"}>
              Back to listing form
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
