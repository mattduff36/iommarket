import { DealerIdentityLink } from "@/components/dealers/dealer-identity-link";
import type { PublicListingDealer } from "@/lib/dealers/public-listing-dealer";

interface ListingDealerIdentityProps {
  fallbackName: string;
  phone?: string | null;
  publicDealer: PublicListingDealer | null;
}

export function ListingDealerIdentity({
  fallbackName,
  phone,
  publicDealer,
}: ListingDealerIdentityProps) {
  return (
    <>
      {publicDealer ? (
        <DealerIdentityLink
          name={publicDealer.name}
          slug={publicDealer.slug}
          verified={publicDealer.verified}
        />
      ) : (
        <p className="text-sm font-semibold text-text-primary">{fallbackName}</p>
      )}
      {/* Listing contact data remains public with the LIVE advert even when
          the dealer profile itself is no longer linkable. */}
      {phone ? <p className="text-sm text-text-secondary">{phone}</p> : null}
    </>
  );
}
