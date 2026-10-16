export const dynamic = "force-dynamic";

import Link from "@/components/navigation/link";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { buildSearchUrl, type SearchParams } from "@/lib/search/search-url";
import {
  CARD_OVERLAY_CONTROL_CLASS,
  CardOverlayLink,
} from "@/components/ui/card-overlay-link";
import { SavedSearchActions } from "./saved-search-actions";

export default async function SavedSearchesPage() {
  const user = await requireAcceptedUser("/account/saved-searches");

  const savedSearches = await db.savedSearch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="section-heading-accent font-heading text-2xl font-bold text-text-primary sm:text-3xl">
          Saved Searches
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Re-run your favourite filters in one click.
        </p>
      </div>

      {savedSearches.length > 0 ? (
        <div className="space-y-3">
          {savedSearches.map((saved) => {
            const params = saved.queryParamsJson as SearchParams;
            const href = buildSearchUrl(params, {});
            return (
              <div
                key={saved.id}
                className="relative flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <CardOverlayLink href={href} label={`Open ${saved.name}`} />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-text-primary">{saved.name}</p>
                  <p className="text-xs text-text-secondary">
                    Saved {saved.createdAt.toLocaleDateString("en-GB")}
                  </p>
                </div>
                <div className={`${CARD_OVERLAY_CONTROL_CLASS} shrink-0 self-end sm:self-auto`}>
                  <SavedSearchActions
                    savedSearchId={saved.id}
                    name={saved.name}
                    href={href}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-text-secondary">No saved searches yet.</p>
          <Link href="/search" className="mt-3 inline-flex text-sm text-text-trust hover:underline">
            Start searching
          </Link>
        </div>
      )}
    </div>
  );
}
