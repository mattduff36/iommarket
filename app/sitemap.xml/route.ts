import { generateSitemaps } from "@/app/catalogue/sitemap";
import { isSearchIndexingEnabled } from "@/lib/seo/indexing-policy";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

export async function GET(): Promise<Response> {
  if (!isSearchIndexingEnabled()) {
    return new Response("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
    });
  }

  const partitions = await generateSitemaps();
  const entries = partitions.map(({ id }) => {
    const location = buildCanonicalUrl(`/catalogue/sitemap/${encodeURIComponent(id)}.xml`);
    return `  <sitemap><loc>${escapeXml(location)}</loc></sitemap>`;
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</sitemapindex>",
  ].join("\n");
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
