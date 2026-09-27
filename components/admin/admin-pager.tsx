import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function AdminPager({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (nextPage: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-wrap items-center justify-center gap-2"
    >
      {page > 1 ? (
        <Link
          href={hrefForPage(page - 1)}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text-secondary transition-colors hover:border-border-focus hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Previous
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm text-text-tertiary opacity-45">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Previous
        </span>
      )}
      <span className="min-w-28 text-center text-sm tabular-nums text-text-tertiary">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          href={hrefForPage(page + 1)}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text-secondary transition-colors hover:border-border-focus hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm text-text-tertiary opacity-45">
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
