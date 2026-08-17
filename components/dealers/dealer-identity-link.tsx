import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { NAVIGABLE_CARD_LINK_CLASS } from "@/components/ui/card-overlay-link";
import { cn } from "@/lib/cn";
import { buildDealerProfilePath } from "@/lib/navigation-paths";

interface DealerIdentityLinkProps {
  name: string;
  slug: string;
  verified: boolean;
}

export function DealerIdentityLink({
  name,
  slug,
  verified,
}: DealerIdentityLinkProps) {
  return (
    <Link
      href={buildDealerProfilePath(slug)}
      aria-label={`View ${name} dealer profile`}
      className={cn(
        "block rounded-lg border border-border bg-surface-elevated/60 px-3 py-3",
        NAVIGABLE_CARD_LINK_CLASS,
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">{name}</span>
        {verified ? (
          <Badge variant="success" className="shrink-0">
            Verified dealer
          </Badge>
        ) : null}
      </span>
      <span className="mt-1 block text-xs font-semibold text-text-trust">
        View dealer profile and all listings
      </span>
    </Link>
  );
}
