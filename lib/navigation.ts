export type AuthRole = "USER" | "DEALER" | "ADMIN" | null | undefined;

interface NavItem {
  label: string;
  href: string;
}

interface AccountNavItem extends NavItem {
  visibility?: "all" | "dealer_admin" | "admin";
}

export const PUBLIC_NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Vehicle Check", href: "/vehicle-check" },
  { label: "Categories", href: "/categories" },
  { label: "Sell", href: "/sell" },
  { label: "Pricing", href: "/pricing" },
];

export const FOOTER_NAV_ITEMS: NavItem[] = [
  ...PUBLIC_NAV_ITEMS,
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Cookies", href: "/cookies" },
  { label: "Buyer Safety", href: "/safety" },
  { label: "Contact", href: "/contact" },
];

const ACCOUNT_NAV_ITEMS: AccountNavItem[] = [
  { label: "Account overview", href: "/account" },
  { label: "My listings", href: "/account/listings" },
  { label: "Profile & Security", href: "/account/profile" },
  { label: "Saved Listings", href: "/account/favourites" },
  { label: "Saved Searches", href: "/account/saved-searches" },
  { label: "Dealer profile", href: "/dealer/profile", visibility: "dealer_admin" },
  { label: "Dealer dashboard", href: "/dealer/dashboard", visibility: "dealer_admin" },
  { label: "Change password", href: "/account/change-password" },
  { label: "Admin area", href: "/admin", visibility: "admin" },
];

function canViewItem(item: AccountNavItem, role: AuthRole): boolean {
  if (!item.visibility || item.visibility === "all") return true;
  if (item.visibility === "admin") return role === "ADMIN";
  return role === "DEALER" || role === "ADMIN";
}

export function getSellLandingPath(role: AuthRole): string | null {
  if (role === "USER") return "/sell/private";
  if (role === "DEALER") return "/sell/dealer";
  return null;
}

export function getRoleLabel(role: AuthRole): string | null {
  if (role === "USER") return "Member";
  if (role === "DEALER") return "Dealer";
  if (role === "ADMIN") return "Admin";
  return null;
}

export function getAccountNavItems(role: AuthRole): AccountNavItem[] {
  return ACCOUNT_NAV_ITEMS.filter((item) => canViewItem(item, role));
}
