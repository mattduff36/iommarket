import { beforeEach, expect, it, vi } from "vitest";
import { loadStockReviewVehicle, saveStockReviewVehicle } from "@/actions/admin/dealer-stock-review-edit";
import { saveAdminListingEdit } from "@/actions/admin/listing-edit";
import { loadListingEditor, saveListingEditor } from "@/components/admin/listing-edit-source";

vi.mock("@/actions/admin/listing-edit", () => ({ loadAdminListingForEdit: vi.fn(), saveAdminListingEdit: vi.fn() }));
vi.mock("@/actions/admin/dealer-stock-review-edit", () => ({ loadStockReviewVehicle: vi.fn(), saveStockReviewVehicle: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it("round-trips stock attribute slugs through the shared ID-based fields and preserves the review guard", async () => {
  const target = { reportId: "report", fingerprint: "fingerprint", sourceIdentityKey: "vehicle" };
  vi.mocked(loadStockReviewVehicle).mockResolvedValue({ data: {
    draft: { title: "Skoda Fabia", description: "Vehicle description", pricePence: null, categorySlug: "car",
      attributes: { transmission: "Manual" }, photoUrls: ["https://dealer.example/car.jpg"], sourceUrl: null, warning: "Missing price", flags: [] },
    categories: [{ id: "car-id", slug: "car", name: "Cars", attributes: [
      { id: "transmission-id", slug: "transmission", name: "Transmission", dataType: "select", required: true, options: '["Manual","Automatic"]' },
    ] }],
  } });
  const result = await loadListingEditor("", target);
  expect(result.data?.listing.attributes).toEqual([{ attributeDefinitionId: "transmission-id", value: "Manual" }]);
  expect(result.data?.stockReview?.draft.pricePence).toBeNull();
  if (!result.data) throw new Error("Missing editor data");
  await saveListingEditor(result.data, { title: "Skoda Fabia", description: "Vehicle description", price: 850000,
    categoryId: "car-id", regionId: "", attributes: [{ attributeDefinitionId: "transmission-id", value: "Automatic" }],
    photoUrls: ["https://dealer.example/car.jpg"], reason: "Confirmed with dealer", confirmAvailable: true });
  expect(saveStockReviewVehicle).toHaveBeenCalledWith({ ...target, title: "Skoda Fabia", description: "Vehicle description", price: 850000,
    categorySlug: "car", attributes: { transmission: "Automatic" }, photoUrls: ["https://dealer.example/car.jpg"], reason: "Confirmed with dealer", confirmAvailable: true });
  expect(saveAdminListingEdit).not.toHaveBeenCalled();
});
