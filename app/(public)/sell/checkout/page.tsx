export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  checkoutViewCopy,
  resolveCheckoutViewState,
} from "@/lib/payments/checkout-view";
import { CheckoutStatusActions } from "./checkout-status-actions";
import { RetryCheckoutButton } from "./retry-checkout-button";

export const metadata: Metadata = {
  title: "Complete Listing Checkout",
  description: "Track hosted payment progress and resume your saved listing flow.",
};

interface Props {
  searchParams: Promise<{
    listing?: string;
    flow?: "private" | "dealer";
    opened?: string;
  }>;
}

export default async function SellCheckoutPage({ searchParams }: Props) {
  const user = await requireAcceptedUser("/sell");

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

  const flow = listing.dealerId ? "dealer" : "private";
  const listingPayment = await db.payment.findFirst({
    where: {
      listingId: listing.id,
      type: "LISTING",
    },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      createdAt: true,
    },
  });
  const openedInNewTab = sp.opened === "1";
  const viewState = resolveCheckoutViewState({
    listingStatus: listing.status,
    payment: listingPayment,
    openedInNewTab,
  });
  const { heading, message, isAwaitingPayment } = checkoutViewCopy(viewState);
  const isSubmitted = viewState === "submitted";
  const hasFailedPayment = viewState === "failed";

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <CardTitle>{heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-secondary">
            {message}
          </p>

          <div className="rounded-lg border border-border bg-surface/60 p-4 text-sm text-text-secondary">
            <p>
              Listing:{" "}
              <span className="font-medium text-text-primary">{listing.title}</span>
            </p>
            <p className="mt-2">
              Draft protection: your listing record and uploaded images are
              already saved in itrader before hosted checkout opens.
            </p>
            {listingPayment ? (
              <p className="mt-2">
                Latest payment status:{" "}
                <span className="font-medium text-text-primary">
                  {listingPayment.status}
                </span>{" "}
                ({listingPayment.createdAt.toLocaleString("en-GB")})
              </p>
            ) : null}
            {hasFailedPayment ? (
              <p className="mt-2 text-text-error">
                The latest hosted payment attempt failed. You can retry without
                losing the saved draft.
              </p>
            ) : null}
          </div>

          <CheckoutStatusActions
            listingId={listing.id}
            flow={flow}
            viewState={viewState}
            isAwaitingPayment={isAwaitingPayment}
          />

          {isSubmitted ? (
            <div className="space-y-3">
              <Button asChild>
                <Link href={`/listings/${listing.id}`}>View listing</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/account/listings">View my listings</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <RetryCheckoutButton listingId={listing.id} flow={flow} />
              <Button asChild variant="ghost">
                <Link
                  href={getDraftEditorHref({
                    listingId: listing.id,
                    dealerId: listing.dealerId,
                  })}
                >
                  Continue editing draft
                </Link>
              </Button>
            </div>
          )}

          <Button asChild variant="ghost">
            <Link href={flow === "dealer" ? "/sell/dealer" : "/sell/private"}>
              Start a different listing
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
