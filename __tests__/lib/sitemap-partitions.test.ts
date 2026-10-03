import { describe, expect, it } from "vitest";
import {
  dedupeSitemapEntries,
  sitemapPartitionIds,
  sliceSitemapPartition,
} from "@/lib/seo/sitemap-partitions";
import { buildListingShareDescription } from "@/lib/seo/listing-description";
import { buildListingProductJsonLd } from "@/lib/seo/listing-json-ld";

describe("sitemap partitions", () => {
  it("covers a boundary without omissions or duplicates", () => {
    const entries = Array.from({ length: 5001 }, (_, index) => ({ url: `https://itrader.im/listings/${index}` }));
    expect(sitemapPartitionIds(entries.length)).toEqual(["0", "1"]);
    const first = sliceSitemapPartition(entries, "0");
    const second = sliceSitemapPartition(entries, "1");
    expect(first).toHaveLength(5000);
    expect(second).toEqual([entries[5000]]);
    expect(new Set([...first, ...second].map((entry) => entry.url)).size).toBe(5001);
    expect(sliceSitemapPartition(entries, "2")).toEqual([]);
  });

  it("drops a repeated URL from a racy read", () => {
    const deduped = dedupeSitemapEntries([
      { url: "https://itrader.im/listings/a" },
      { url: "https://itrader.im/listings/a" },
      { url: "https://itrader.im/listings/b" },
    ]);
    expect(deduped.map((entry) => entry.url)).toEqual([
      "https://itrader.im/listings/a",
      "https://itrader.im/listings/b",
    ]);
  });
});

describe("listing share text and schema", () => {
  it("uses available facts and does not cut a description mid-sentence", () => {
    expect(buildListingShareDescription({
      title: "Ford Focus",
      year: "2018",
      location: "Douglas",
      priceLabel: "£4,500.00",
      description: "Imported boilerplate that should not replace the facts.",
    })).toBe("2018 Ford Focus, located in Douglas, advertised at £4,500.00.");
    const long = "This is a complete sentence about the van. This second sentence should remain because it still fits. This third sentence is the one that would push the text past the limit and must be left off.";
    const summary = buildListingShareDescription({
      title: "A".repeat(210),
      description: long,
    });
    expect(summary.endsWith(".")).toBe(true);
    expect(summary).not.toContain("third sentence");
  });

  it("matches sold availability and escapes through the serializer contract", () => {
    const data = buildListingProductJsonLd({
      id: "listing-1",
      url: "https://itrader.im/listings/listing-1",
      name: "Sold van",
      description: "This vehicle has been sold.",
      images: [],
      price: 1000,
      currency: "GBP",
      availability: "https://schema.org/SoldOut",
      attributes: [{ slug: "make", value: "Ford" }, { slug: "condition", value: "Used" }],
      seller: { kind: "dealer", name: "Island Motors", url: "https://itrader.im/dealers/island" },
    });
    expect(data.offers.availability).toBe("https://schema.org/SoldOut");
    expect(data.offers.priceCurrency).toBe("GBP");
    expect(data.brand).toEqual({ "@type": "Brand", name: "Ford" });
    expect(data.offers.seller).toMatchObject({ "@type": "AutoDealer", name: "Island Motors" });
    expect(JSON.stringify(data)).not.toContain("aggregateRating");
  });
});
