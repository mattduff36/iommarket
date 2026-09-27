export type AdminNavIcon =
  | "analytics"
  | "audit"
  | "cancellations"
  | "categories"
  | "checklist"
  | "costs"
  | "dashboard"
  | "dealer-onboarding"
  | "dealers"
  | "listings"
  | "media"
  | "monitoring"
  | "pages"
  | "payments"
  | "preview-packs"
  | "regions"
  | "reports"
  | "revenue"
  | "reviews"
  | "settings"
  | "users"
  | "vehicle-catalogue"
  | "waitlist";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: AdminNavIcon;
  group: "core" | "operations" | "content" | "insights";
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: "dashboard", group: "core" },
  { label: "Users", href: "/admin/users", icon: "users", group: "core" },
  { label: "Dealers", href: "/admin/dealers", icon: "dealers", group: "core" },
  { label: "Dealer onboarding", href: "/admin/dealer-onboarding", icon: "dealer-onboarding", group: "core" },
  { label: "Preview packs", href: "/admin/preview-packs", icon: "preview-packs", group: "core" },
  { label: "Listings", href: "/admin/listings", icon: "listings", group: "core" },
  { label: "Categories", href: "/admin/categories", icon: "categories", group: "core" },
  { label: "Vehicle Catalogue", href: "/admin/vehicle-catalogue", icon: "vehicle-catalogue", group: "core" },
  { label: "Regions", href: "/admin/regions", icon: "regions", group: "core" },
  { label: "Reports", href: "/admin/reports", icon: "reports", group: "operations" },
  { label: "Reviews", href: "/admin/reviews", icon: "reviews", group: "operations" },
  { label: "Waitlist", href: "/admin/waitlist", icon: "waitlist", group: "operations" },
  { label: "Checklist", href: "/admin/checklist", icon: "checklist", group: "operations" },
  { label: "Payments", href: "/admin/payments", icon: "payments", group: "operations" },
  { label: "Cancellations", href: "/admin/cancellations", icon: "cancellations", group: "operations" },
  { label: "Revenue", href: "/admin/revenue", icon: "revenue", group: "operations" },
  { label: "Costs", href: "/admin/costs", icon: "costs", group: "operations" },
  { label: "Pages", href: "/admin/pages", icon: "pages", group: "content" },
  { label: "Media", href: "/admin/media", icon: "media", group: "content" },
  { label: "Audit", href: "/admin/audit", icon: "audit", group: "insights" },
  { label: "Analytics", href: "/admin/analytics", icon: "analytics", group: "insights" },
  { label: "Monitoring", href: "/admin/monitoring", icon: "monitoring", group: "insights" },
  { label: "Settings", href: "/admin/settings", icon: "settings", group: "insights" },
];

export const ADMIN_NAV_GROUPS = [
  { key: "core" as const, label: "Core", accent: "text-neon-blue-400" },
  { key: "operations" as const, label: "Operations", accent: "text-neon-red-400" },
  { key: "content" as const, label: "Content", accent: "text-premium-gold-400" },
  { key: "insights" as const, label: "Insights", accent: "text-emerald-500" },
];
