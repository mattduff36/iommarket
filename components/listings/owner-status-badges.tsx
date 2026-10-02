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
  statusVariant = "neutral",
}: {
  status: string;
  featured: boolean;
  featuredPurchased?: boolean;
  statusVariant?: NonNullable<BadgeProps["variant"]>;
}) {
  const placement = featured ? "Featured" : featuredPurchased ? "Featured pending" : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={statusVariant}>{listingStatusLabel(status)}</Badge>
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
