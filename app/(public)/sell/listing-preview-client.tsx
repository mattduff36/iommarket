"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ListingImageGallery } from "../listings/[id]/listing-image-gallery";
import { ExpandableDescription } from "../listings/[id]/expandable-description";
import { ListingSpecificationGroups } from "@/components/listings/listing-specification-groups";
import { isMeaningfulDetailValue } from "@/lib/listings/guided-listing-workflow";
import { browserDraftStorage, type UnsavedListingDraft } from "./listing-unsaved-draft";
import { loadListingPreview } from "./listing-preview-data";

interface Category {
  id: string; name: string; slug: string;
  attributes: Array<{ id: string; name: string; slug: string; sortOrder?: number }>;
}

export function ListingPreviewClient({ userId, mode, categories, regions }: {
  userId: string; mode: "private" | "dealer"; categories: Category[];
  regions: Array<{ id: string; name: string }>;
}) {
  const [draft, setDraft] = useState<UnsavedListingDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const storage = browserDraftStorage();
    setDraft(storage ? loadListingPreview(storage, {
      userId, mode, catalog: {
        categories: categories.map((category) => ({ id: category.id, attributeIds: category.attributes.map((attribute) => attribute.id) })),
        regionIds: regions.map((region) => region.id),
      },
    }) : null);
    setLoaded(true);
  }, [userId, mode, categories, regions]);

  const category = categories.find((item) => item.id === draft?.categoryId);
  const returnHref = mode === "dealer" ? "/sell/dealer" : "/sell/private";
  if (!loaded) return <p className="mx-auto max-w-6xl px-4 py-12">Loading your preview…</p>;
  if (!draft || !category) return <div className="mx-auto max-w-3xl space-y-4 px-4 py-12">
    <h1 className="text-2xl font-bold">Preview unavailable</h1>
    <p>Open Preview listing from the final step of your listing form in this browser. Your listing has not been submitted.</p>
    <Link href={returnHref} className="text-text-trust underline">Return to listing form</Link>
  </div>;

  const price = draft.price ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(draft.price)) : "Price not entered";
  const region = regions.find((item) => item.id === draft.regionId)?.name;
  const attributes = category.attributes.filter((attribute) =>
    !["location", "previously-written-off"].includes(attribute.slug) && isMeaningfulDetailValue(draft.attributes[attribute.id]),
  ).map((attribute, index) => ({ slug: attribute.slug, name: attribute.name, value: draft.attributes[attribute.id], sortOrder: attribute.sortOrder ?? index }));

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neon-blue-500/30 bg-neon-blue-500/10 p-4">
      <div><p className="font-semibold">Preview — not submitted</p><p className="mt-1 text-sm text-text-secondary">Only you can see this preview on this device. Return to the original tab to keep editing.</p></div>
      <Button type="button" variant="ghost" onClick={() => window.close()}>Close preview</Button>
    </div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <ListingImageGallery images={[...draft.photos].sort((left, right) => left.order - right.order)} title={draft.title || "Your listing"} isSold={false} />
        <h1 className="mt-6 text-3xl font-bold text-text-primary">{draft.title || "Your listing title"}</h1>
        <p className="mt-2 text-sm text-text-secondary">{[category.name, region].filter(Boolean).join(" · ")}</p>
        <section className="mt-8"><h2 className="section-heading-accent mb-5 text-lg font-bold">Description</h2><ExpandableDescription description={draft.description || "No description entered."} /></section>
        <ListingSpecificationGroups categorySlug={category.slug} attributes={attributes} />
      </div>
      <aside><div className="rounded-xl border border-border bg-surface p-6 lg:sticky lg:top-24">
        <p className="text-3xl font-bold text-text-primary">{price}</p>
        <p className="mt-4 text-sm text-text-secondary">{mode === "dealer" ? "Dealer listing" : "Private seller"}{region ? ` · ${region}` : ""}</p>
        <p className="mt-6 border-t border-border pt-4 text-sm text-text-secondary">Contact and other buyer actions appear on the published listing.</p>
      </div></aside>
    </div>
  </main>;
}
