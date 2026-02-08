"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createListing, saveListingImages } from "@/actions/listings";
import { payForListing } from "@/actions/payments";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";

interface AttributeDef {
  id: string;
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  options: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  attributes: AttributeDef[];
}

interface RegionOption {
  id: string;
  name: string;
}

interface Props {
  categories: CategoryOption[];
  regions: RegionOption[];
}

export function CreateListingForm({ categories, regions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);

    const attributes: Array<{ attributeDefinitionId: string; value: string }> = [];
    if (selectedCategory) {
      for (const attr of selectedCategory.attributes) {
        const val = form.get(`attr-${attr.id}`) as string;
        if (val) {
          attributes.push({ attributeDefinitionId: attr.id, value: val });
        }
      }
    }

    startTransition(async () => {
      const result = await createListing({
        title: form.get("title") as string,
        description: form.get("description") as string,
        price: Math.round(parseFloat(form.get("price") as string) * 100),
        categoryId: form.get("categoryId") as string,
        regionId: form.get("regionId") as string,
        attributes,
      });

      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Please check the form for errors."
        );
        return;
      }

      if (result.data) {
        // Save uploaded images
        if (uploadedImages.length > 0) {
          await saveListingImages(result.data.id, uploadedImages);
        }

        const payResult = await payForListing(result.data.id);
        if (payResult.data?.checkoutUrl) {
          window.location.href = payResult.data.checkoutUrl;
        } else {
          router.push(`/listings/${result.data.id}`);
        }
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listing Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Title"
            name="title"
            required
            minLength={5}
            maxLength={120}
            placeholder="e.g. 2019 BMW 320d M Sport"
          />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="description"
              className="text-sm font-medium text-text-primary"
            >
              Description
            </label>
            <textarea
              id="description"
              name="description"
              required
              minLength={20}
              maxLength={5000}
              rows={6}
              placeholder="Describe your item in detail..."
              className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline"
            />
          </div>

          <Input
            label="Price (£)"
            name="price"
            type="number"
            required
            min={1}
            max={1000000}
            step={0.01}
            placeholder="e.g. 15000"
          />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="categoryId"
              className="text-sm font-medium text-text-primary"
            >
              Category
            </label>
            <select
              id="categoryId"
              name="categoryId"
              required
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline"
            >
              <option value="">Select a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="regionId"
              className="text-sm font-medium text-text-primary"
            >
              Region
            </label>
            <select
              id="regionId"
              name="regionId"
              required
              className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline"
            >
              <option value="">Select a region</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Image upload */}
          <ImageUpload
            images={uploadedImages}
            onImagesChange={setUploadedImages}
            maxImages={10}
          />

          {/* Dynamic category attributes */}
          {selectedCategory && selectedCategory.attributes.length > 0 && (
            <div className="space-y-4 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-text-primary">
                {selectedCategory.name} Details
              </h3>
              {selectedCategory.attributes.map((attr) => {
                if (attr.dataType === "select" && attr.options) {
                  const opts = JSON.parse(attr.options) as string[];
                  return (
                    <div key={attr.id} className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-text-primary">
                        {attr.name}
                        {attr.required && " *"}
                      </label>
                      <select
                        name={`attr-${attr.id}`}
                        required={attr.required}
                        className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline"
                      >
                        <option value="">Select...</option>
                        {opts.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  );
                }

                return (
                  <Input
                    key={attr.id}
                    label={`${attr.name}${attr.required ? " *" : ""}`}
                    name={`attr-${attr.id}`}
                    required={attr.required}
                    type={attr.dataType === "number" ? "number" : "text"}
                  />
                );
              })}
            </div>
          )}

          {error && (
            <p className="text-sm text-text-error">{error}</p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={isPending}>
            Create & Pay £4.99
          </Button>

          <p className="text-xs text-text-tertiary text-center">
            Your listing will be reviewed by our moderation team before going
            live. Payment of £4.99 covers a 30-day listing.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
