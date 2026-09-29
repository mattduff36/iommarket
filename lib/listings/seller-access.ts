export const ADMIN_OWNED_LISTING_ERROR =
  "Admin accounts cannot create or manage their own listings.";

export function isAdminSellerBlocked(role: string | null | undefined) {
  return role === "ADMIN";
}
