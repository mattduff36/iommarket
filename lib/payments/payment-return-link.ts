export function isSafeInternalReturnHref(
  returnTo: string | undefined
): returnTo is `/${string}` {
  return Boolean(returnTo && /^\/(?!\/)/.test(returnTo));
}

export function resolveReturnHref(
  returnTo: string | undefined,
  context: "listing" | "featured" | "subscription" | undefined,
  listingId: string | undefined
): string {
  if (isSafeInternalReturnHref(returnTo)) {
    return returnTo;
  }

  if (context === "featured" && listingId) {
    return `/listings/${listingId}`;
  }

  if (context === "subscription") {
    return "/dealer/dashboard";
  }

  return listingId ? `/sell/checkout?listing=${listingId}` : "/";
}

