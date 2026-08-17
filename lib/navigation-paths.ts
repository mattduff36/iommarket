export function encodePathSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Path segments must not be empty.");
  }
  return encodeURIComponent(normalized);
}

export function buildDealerProfilePath(slug: string): string {
  return `/dealers/${encodePathSegment(slug)}`;
}

export function buildListingPath(id: string): string {
  return `/listings/${encodePathSegment(id)}`;
}

export function buildCategorySearchPath(slug: string): string {
  const normalized = slug.trim();
  if (!normalized) {
    throw new Error("Category slugs must not be empty.");
  }
  const params = new URLSearchParams({ category: normalized });
  return `/search?${params.toString()}`;
}
