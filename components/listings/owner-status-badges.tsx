import { LISTING_STATUS_VARIANT } from "@/lib/listings/status-variant";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Awaiting review",
  TAKEN_DOWN: "Taken down",
  ADMIN_PREVIEW: "Admin preview",
};

export function listingStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

/**
 * Lifecycle status plus an explicit Featured label. Colour is not the only
 * signal: active placement says "Featured", and a paid placement that has not
 * started yet says "Featured pending".
 */
export function ListingOwnerStatusBadges({
  status,
  featured,
  featuredPurchased = false,
  statusDetail,
  statusVariant = LISTING_STATUS_VARIANT[status] ?? "neutral",
}: {
  status: string;
  featured: boolean;
  featuredPurchased?: boolean;
  statusDetail?: string;
  statusVariant?: NonNullable<BadgeProps["variant"]>;
}) {
  const placement = featured ? "Featured" : featuredPurchased ? "Featured pending" : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {statusDetail ? (
        <details className="inline-block">
          <summary title={statusDetail} className="list-none cursor-help rounded-full focus-visible:outline [&::-webkit-details-marker]:hidden">
            <Badge variant={statusVariant}>{listingStatusLabel(status)}</Badge>
          </summary>
          <span className="mt-1 block max-w-48 text-xs text-text-secondary">{statusDetail}</span>
        </details>
      ) : <Badge variant={statusVariant}>{listingStatusLabel(status)}</Badge>}
      {placement ? (
        <Badge variant="premium">
          <span aria-hidden="true" className="mr-1">
            ★
          </span>
          {placement}
        </Badge>
      ) : null}
    </span>
  );
}
