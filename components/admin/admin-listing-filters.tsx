"use client";

import {
  ADMIN_LISTING_STATUS_FILTERS,
  type AdminListingStatusFilter,
} from "@/lib/admin/query";
import {
  AdminFilterBar,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";

export function AdminListingFilters({
  query,
  status,
}: {
  query: string;
  status: AdminListingStatusFilter;
}) {
  return (
    <AdminFilterBar>
      <form className="flex min-w-0 flex-1 flex-wrap gap-2" method="get">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search title or seller"
          aria-label="Search listings"
          className={adminSearchInputClass}
        />
        <select
          name="status"
          defaultValue={status}
          aria-label="Listing status"
          className="h-9 rounded-md border border-border bg-canvas px-3 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-neon-blue-500/20"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {ADMIN_LISTING_STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === "ALL" ? "All statuses" : value}
            </option>
          ))}
        </select>
        <button type="submit" className={adminSearchButtonClass}>
          Filter
        </button>
      </form>
    </AdminFilterBar>
  );
}
