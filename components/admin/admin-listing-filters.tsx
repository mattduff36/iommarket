"use client";

import {
  ADMIN_LISTING_STATUS_FILTERS,
  type AdminListingStatusFilter,
} from "@/lib/admin/query";

export function AdminListingFilters({
  query,
  status,
}: {
  query: string;
  status: AdminListingStatusFilter;
}) {
  return (
    <form className="mb-4 flex flex-wrap gap-2" method="get">
      <input
        name="q"
        defaultValue={query}
        placeholder="Search title or seller"
        className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
      />
      <select
        name="status"
        defaultValue={status}
        aria-label="Listing status"
        className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {ADMIN_LISTING_STATUS_FILTERS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="h-9 rounded-md border border-border px-3 text-sm"
      >
        Filter
      </button>
    </form>
  );
}
