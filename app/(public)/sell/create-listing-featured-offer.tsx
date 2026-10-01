"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { formatGbpFromPence } from "@/lib/formatting/gbp";
import { featuredCheckoutTotalPence } from "./featured-checkout";

interface FeaturedCheckoutOfferProps {
  listingFeePence: number;
  featuredUpgradePricePence: number;
  listingFeeDue: boolean;
  includeFeatured: boolean;
  alreadyPurchased?: boolean;
  onIncludeFeaturedChange: (includeFeatured: boolean) => void;
}

export function FeaturedCheckoutOffer({
  listingFeePence,
  featuredUpgradePricePence,
  listingFeeDue,
  includeFeatured,
  alreadyPurchased = false,
  onIncludeFeaturedChange,
}: FeaturedCheckoutOfferProps) {
  const listingFee = formatGbpFromPence(listingFeePence);
  const featuredFee = formatGbpFromPence(featuredUpgradePricePence);
  const total = formatGbpFromPence(
    featuredCheckoutTotalPence({
      listingFeePence,
      featuredUpgradePricePence,
      listingFeeDue,
      includeFeatured: alreadyPurchased ? false : includeFeatured,
    }),
  );

  if (alreadyPurchased) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-surface/60 p-3 text-sm text-text-secondary">
        <p>Featured is already purchased for this listing. This checkout does not buy it again.</p>
        {listingFeeDue ? (
          <p>
            Listing fee {listingFee}. Total {listingFee}.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface/60 p-3">
      <div className="space-y-1 text-sm text-text-secondary">
        {listingFeeDue ? (
          <>
            <p>Listing fee {listingFee}.</p>
            <p>Featured {featuredFee}, optional.</p>
            <p>
              Total <span className="font-medium text-text-primary">{total}</span>.
            </p>
            <p>Choosing Featured adds it to this checkout.</p>
          </>
        ) : (
          <>
            <p>No listing fee is due.</p>
            <p>
              Featured is a separate payment of {featuredFee} after the listing is submitted.
              If that Featured payment is declined, the standard listing stays submitted.
            </p>
            {includeFeatured ? (
              <p>
                Featured total <span className="font-medium text-text-primary">{featuredFee}</span>.
              </p>
            ) : null}
          </>
        )}
        <p>Featured placement starts after the listing is approved.</p>
      </div>
      <Checkbox
        checked={includeFeatured}
        onCheckedChange={(checked) => onIncludeFeaturedChange(checked === true)}
        label={
          listingFeeDue ? "Add Featured to this checkout" : "Add Featured after submission"
        }
      />
    </div>
  );
}
