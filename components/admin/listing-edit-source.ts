import { loadAdminListingForEdit, saveAdminListingEdit } from "@/actions/admin/listing-edit";
import { loadStockReviewVehicle, saveStockReviewVehicle } from "@/actions/admin/dealer-stock-review-edit";

export type StockReviewEditTarget = { reportId: string; fingerprint: string; sourceIdentityKey: string };
type AdminEditData = NonNullable<Extract<Awaited<ReturnType<typeof loadAdminListingForEdit>>, { data?: unknown }>["data"]>;
type ReviewData = NonNullable<Extract<Awaited<ReturnType<typeof loadStockReviewVehicle>>, { data?: unknown }>["data"]>;
export type ListingEditorData = AdminEditData & { stockReview?: { target: StockReviewEditTarget; draft: ReviewData["draft"] } };

export function listingEditorSourceUrl(data: ListingEditorData | null) {
  try {
    const url = new URL(data?.stockReview?.draft.sourceUrl ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Storage adapters share the same fields and interactions in ListingEditDialog. */
export async function loadListingEditor(listingId: string, target?: StockReviewEditTarget): Promise<{ data?: ListingEditorData; error?: string }> {
  if (listingId) return loadAdminListingForEdit(listingId);
  if (!target) return { error: "No listing or stock review was selected." };
  const result = await loadStockReviewVehicle(target);
  if (!("data" in result) || !result.data) return { error: result.error || "Could not load this vehicle." };
  const { draft, categories } = result.data;
  const category = categories.find(item => item.slug === draft.categorySlug);
  return { data: {
    listing: {
      id: "", title: draft.title, description: draft.description, price: draft.pricePence ?? 0,
      status: "DRAFT", categoryId: category?.id ?? "", regionId: "",
      lifecycleRevision: 0, updatedAt: "", photoCount: draft.photoUrls.length,
      attributes: (category?.attributes ?? []).flatMap(attribute => {
        const value = draft.attributes[attribute.slug];
        return value ? [{ attributeDefinitionId: attribute.id, value }] : [];
      }),
    },
    categories, regions: [], hasOpenRevision: false, openRevisionStatus: null,
    stockReview: { target, draft },
  } };
}

export type ListingEditorValues = {
  title: string; description: string; price: number; categoryId: string; regionId: string;
  attributes: Array<{ attributeDefinitionId: string; value: string }>;
  photoUrls: string[]; reason: string; confirmAvailable: boolean;
};

export async function saveListingEditor(data: ListingEditorData, values: ListingEditorValues) {
  if (!data.stockReview) {
    return saveAdminListingEdit({ title: values.title, description: values.description, price: values.price,
      categoryId: values.categoryId, regionId: values.regionId, attributes: values.attributes,
      listingId: data.listing.id, expectedLifecycleRevision: data.listing.lifecycleRevision, expectedUpdatedAt: data.listing.updatedAt });
  }
  const category = data.categories.find(item => item.id === values.categoryId);
  const attributes = Object.fromEntries(values.attributes.flatMap(item => {
    const definition = category?.attributes.find(attribute => attribute.id === item.attributeDefinitionId);
    return definition ? [[definition.slug, item.value]] : [];
  }));
  return saveStockReviewVehicle({ ...data.stockReview.target, title: values.title, description: values.description,
    price: values.price, categorySlug: category?.slug, attributes, photoUrls: values.photoUrls,
    reason: values.reason, confirmAvailable: values.confirmAvailable });
}
