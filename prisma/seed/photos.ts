import { LISTING_PHOTO_EXTRAS } from "./listing-photo-sets";
import { LISTING_IMAGES } from "./vehicles";

export type PhotoKind = "hatch" | "saloon" | "suv" | "estate" | "coupe" | "van" | "bike" | "motorhome";

export function photoKindFor(input: {
  category: "car" | "van" | "motorbike" | "motorhome";
  bodyType?: string;
}): PhotoKind {
  if (input.category === "van") return "van";
  if (input.category === "motorbike") return "bike";
  if (input.category === "motorhome") return "motorhome";
  const body = input.bodyType?.toLowerCase() ?? "";
  if (body.includes("suv") || body.includes("pickup")) return "suv";
  if (body.includes("estate")) return "estate";
  if (body.includes("coupe") || body.includes("convertible")) return "coupe";
  if (body.includes("saloon")) return "saloon";
  return "hatch";
}

export function listingImageUrls(input: {
  kind?: PhotoKind;
  index: number;
  count: number;
}): string[] {
  const hero = LISTING_IMAGES[input.index % LISTING_IMAGES.length];
  const extras = LISTING_PHOTO_EXTRAS[hero] ?? [];
  return [hero, ...extras];
}

export function assertOriginalSampleImages(urls: string[]) {
  const original = new Set<string>(LISTING_IMAGES);
  if (!urls[0] || !original.has(urls[0])) {
    throw new Error("Hero photo URL is not from the original main-branch sample set.");
  }
}

export function applyUniqueSampleHeroFeatured<
  T extends { status: string; featured: boolean; imageUrls: string[] },
>(listings: T[]): T[] {
  const seen = new Set<string>();
  const original = new Set<string>(LISTING_IMAGES);
  return listings.map((listing) => {
    const hero = listing.imageUrls[0];
    const feature =
      listing.status === "LIVE" && Boolean(hero) && original.has(hero) && !seen.has(hero);
    if (feature && hero) seen.add(hero);
    if (listing.featured === feature) return listing;
    return { ...listing, featured: feature };
  });
}
