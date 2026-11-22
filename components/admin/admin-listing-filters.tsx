"use client";

import type { ReactNode } from "react";
import {
  ADMIN_LISTING_STATUS_FILTERS,
  type AdminListingStatusFilter,
} from "@/lib/admin/listing-status-filters";
import {
  AdminFilterBar,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";

export function AdminListingFilters({
  query,
  featured,
  condition,
  status,
  sort,
  direction,
  tools,
}: {
  query: string;
  featured?: "yes" | "no";
  condition?: string;
  status: AdminListingStatusFilter;
  sort?: string;
  direction?: string;
  tools?: ReactNode;
}) {
  return (
    <AdminFilterBar tools={tools}>
      <form className="flex min-w-0 flex-1 flex-wrap gap-2" method="get">
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
        {direction ? <input type="hidden" name="dir" value={direction} /> : null}
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
        <select name="condition" aria-label="Vehicle condition" defaultValue={condition ?? ""} className="h-9 rounded-md border border-border bg-canvas px-3 text-sm text-text-primary" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All conditions</option><option value="NEW">New</option><option value="USED">Used</option><option value="REVIEW">Needs condition review</option></select>
        <select name="featured" aria-label="Featured placement" defaultValue={featured ?? ""}
          className="h-9 rounded-md border border-border bg-canvas px-3 text-sm text-text-primary"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}>
          <option value="">All placements</option>
          <option value="yes">Featured</option>
          <option value="no">Not featured</option>
        </select>
        <button type="submit" className={adminSearchButtonClass}>
          Filter
        </button>
      </form>
    </AdminFilterBar>
  );
}
