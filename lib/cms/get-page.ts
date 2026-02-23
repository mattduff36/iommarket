import { db } from "@/lib/db";

/**
 * Fetch a published CMS content page by slug.
 * Returns null if not found or not published.
 */
export async function getPublishedPage(slug: string) {
  return db.contentPage.findFirst({
    where: { slug, status: "PUBLISHED" },
  });
}
