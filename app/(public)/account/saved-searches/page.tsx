export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildSearchUrl, type SearchParams } from "@/lib/search/search-url";
import { DeleteSavedSearchButton } from "./delete-saved-search-button";

export default async function SavedSearchesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const savedSearches = await db.savedSearch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Saved Searches
      </h1>
      <p className="mt-3 text-sm text-text-secondary">
        Re-run your favourite filters in one click.
      </p>

      {savedSearches.length > 0 ? (
        <div className="mt-6 space-y-3">
          {savedSearches.map((saved) => {
            const params = saved.queryParamsJson as SearchParams;
            const href = buildSearchUrl(params, {});
            return (
              <div
                key={saved.id}
                className="rounded-lg border border-border bg-surface p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-medium text-text-primary">{saved.name}</p>
                  <p className="text-xs text-text-secondary">
                    Saved {saved.createdAt.toLocaleDateString("en-GB")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={href}
                    className="text-sm text-text-trust hover:underline"
                  >
                    Open
                  </Link>
                  <DeleteSavedSearchButton savedSearchId={saved.id} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-8 text-sm text-text-secondary">
          No saved searches yet.{" "}
          <Link href="/search" className="text-text-trust hover:underline">
            Start searching
          </Link>
          .
        </p>
      )}
    </div>
  );
}
