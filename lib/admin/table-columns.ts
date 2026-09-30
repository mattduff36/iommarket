import { adminActionsCellClass } from "@/components/admin/admin-table";
import type { AdminColumn, AdminSortFallback } from "@/lib/admin/table-state";

function columns(definitions: readonly AdminColumn[]) {
  return definitions;
}

export const LISTING_TABLE_COLUMNS = columns([
  { id: "title", label: "Title", defaultDirection: "asc", pinned: true },
  { id: "seller", label: "Seller", defaultDirection: "asc" },
  { id: "category", label: "Category", defaultDirection: "asc" },
  { id: "price", label: "Price", defaultDirection: "desc", align: "end" },
  { id: "status", label: "Status", defaultDirection: "asc" },
  { id: "reports", label: "Reports", defaultDirection: "desc", align: "end" },
  { id: "created", label: "Date added", defaultDirection: "desc" },
  { id: "approved", label: "Date approved", defaultDirection: "desc" },
  { id: "region", label: "Region", defaultDirection: "asc", defaultVisible: false },
  { id: "featured", label: "Featured", defaultDirection: "desc", defaultVisible: false },
  { id: "views", label: "Views", defaultDirection: "desc", align: "end", defaultVisible: false },
  { id: "expires", label: "Expires", defaultDirection: "desc", defaultVisible: false },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const LISTING_TABLE_SORT: AdminSortFallback = {
  column: "created",
  direction: "desc",
};

export const USER_TABLE_COLUMNS = columns([
  { id: "user", label: "User", defaultDirection: "asc", pinned: true },
  { id: "access", label: "Access", defaultDirection: "asc" },
  { id: "region", label: "Region", defaultDirection: "asc" },
  { id: "dealer", label: "Dealer", defaultDirection: "asc" },
  { id: "listings", label: "Listings", defaultDirection: "desc", align: "end" },
  { id: "joined", label: "Joined", defaultDirection: "desc" },
  { id: "phone", label: "Phone", defaultDirection: "asc", defaultVisible: false },
  { id: "updated", label: "Updated", defaultDirection: "desc" },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const USER_TABLE_SORT: AdminSortFallback = {
  column: "joined",
  direction: "desc",
};

export const DEALER_TABLE_COLUMNS = columns([
  { id: "dealer", label: "Dealer", defaultDirection: "asc", pinned: true },
  { id: "owner", label: "Owner", defaultDirection: "asc" },
  { id: "verified", label: "Verified", defaultDirection: "desc" },
  { id: "plan", label: "Plan & access" },
  { id: "listings", label: "Listings", defaultDirection: "desc", align: "end" },
  { id: "joined", label: "Joined", defaultDirection: "desc" },
  { id: "tier", label: "Tier", defaultDirection: "asc", defaultVisible: false },
  { id: "access-ends", label: "Access ends", defaultVisible: false },
  { id: "updated", label: "Updated", defaultDirection: "desc" },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const DEALER_TABLE_SORT: AdminSortFallback = {
  column: "joined",
  direction: "desc",
};

export const PAYMENT_TABLE_COLUMNS = columns([
  { id: "date", label: "Date", defaultDirection: "desc" },
  { id: "listing", label: "Listing", defaultDirection: "asc", pinned: true },
  { id: "type", label: "Type", defaultDirection: "asc" },
  { id: "amount", label: "Amount", defaultDirection: "desc", align: "end" },
  { id: "status", label: "Status", defaultDirection: "asc" },
  { id: "reference", label: "Provider Ref" },
  { id: "provider", label: "Provider", defaultDirection: "asc" },
  { id: "currency", label: "Currency", defaultDirection: "asc", defaultVisible: false },
  { id: "refunded", label: "Refunded", defaultDirection: "desc" },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const PAYMENT_TABLE_SORT: AdminSortFallback = {
  column: "date",
  direction: "desc",
};

export const SUBSCRIPTION_TABLE_COLUMNS = columns([
  { id: "dealer", label: "Dealer", defaultDirection: "asc", pinned: true },
  { id: "status", label: "Status", defaultDirection: "asc" },
  { id: "period", label: "Period end" },
  { id: "source", label: "Source", defaultDirection: "asc" },
  { id: "reference", label: "Provider Ref" },
  { id: "provider", label: "Provider", defaultDirection: "asc" },
  { id: "created", label: "Created", defaultDirection: "desc" },
  { id: "tier", label: "Tier", defaultDirection: "asc", defaultVisible: false },
  { id: "cancel", label: "Period-end cancel", defaultDirection: "desc" },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const SUBSCRIPTION_TABLE_SORT: AdminSortFallback = {
  column: "created",
  direction: "desc",
};

export const WAITLIST_TABLE_COLUMNS = columns([
  { id: "email", label: "Email", defaultDirection: "asc", pinned: true },
  { id: "interests", label: "Interests" },
  { id: "joined", label: "Date joined", defaultDirection: "desc" },
  { id: "source", label: "Source", defaultDirection: "asc" },
  { id: "consent", label: "Marketing consent", defaultDirection: "desc" },
  { id: "deleted", label: "Deleted", defaultDirection: "desc", defaultVisible: false },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const WAITLIST_TABLE_SORT: AdminSortFallback = {
  column: "joined",
  direction: "desc",
};

export const PAGE_TABLE_COLUMNS = columns([
  { id: "title", label: "Title", defaultDirection: "asc", pinned: true },
  { id: "slug", label: "Slug", defaultDirection: "asc" },
  { id: "status", label: "Status", defaultDirection: "asc" },
  { id: "updated", label: "Updated", defaultDirection: "desc" },
  { id: "created", label: "Created", defaultDirection: "desc", defaultVisible: false },
  { id: "published", label: "Published", defaultDirection: "desc" },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const PAGE_TABLE_SORT: AdminSortFallback = {
  column: "updated",
  direction: "desc",
};

export const CANCELLATION_TABLE_COLUMNS = columns([
  { id: "dealer", label: "Dealer", defaultDirection: "asc", pinned: true },
  { id: "status", label: "Status", defaultDirection: "asc" },
  { id: "period", label: "Period end", defaultDirection: "desc" },
  { id: "provider", label: "Provider" },
  { id: "requested", label: "Requested", defaultDirection: "desc" },
  { id: "processed", label: "Processed", defaultDirection: "desc" },
  { id: "actions", label: "Actions", pinned: true, headerClassName: adminActionsCellClass },
]);

export const CANCELLATION_TABLE_SORT: AdminSortFallback = {
  column: "requested",
  direction: "desc",
};

export const PREVIEW_PACK_TABLE_COLUMNS = columns([
  { id: "dealer", label: "Dealer", defaultDirection: "asc", pinned: true },
  { id: "snapshot", label: "Snapshot", defaultDirection: "asc" },
  { id: "importable", label: "Importable", defaultDirection: "desc", align: "end" },
  { id: "database", label: "In database", defaultDirection: "desc", align: "end" },
  { id: "vehicles", label: "Unique vehicles", defaultDirection: "desc", align: "end" },
  { id: "status", label: "Status" },
  { id: "visible", label: "Visible", pinned: true, headerClassName: adminActionsCellClass },
]);

export const PREVIEW_PACK_TABLE_SORT: AdminSortFallback = {
  column: "dealer",
  direction: "asc",
};
