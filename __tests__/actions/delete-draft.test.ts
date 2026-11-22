import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, capture, revalidate } = vi.hoisted(() => ({
  transaction: vi.fn(), capture: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/policy/gate", () => ({ requireAcceptedAuth: async () => ({ id: "owner" }) }));
vi.mock("@/lib/monitoring", () => ({ captureException: capture }));
vi.mock("@/lib/listings/delete-draft", () => ({
  DeleteDraftError: class DeleteDraftError extends Error {}, deleteDraftInTransaction: vi.fn(),
}));

import { deleteMyDraft } from "@/actions/delete-draft";
import { DeleteDraftError } from "@/lib/listings/delete-draft";
import { JOURNEY_UNKNOWN_DESTRUCTIVE } from "@/lib/forms/journey-public-error";

describe("delete draft action public boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); capture.mockResolvedValue(null); });
  it("presents only approved domain conflicts", async () => {
    transaction.mockRejectedValue(new DeleteDraftError("This draft changed. Refresh your listings before deleting it."));
    expect(await deleteMyDraft({ listingId: "draft", expectedRevision: 1 })).toMatchObject({
      error: "This draft changed. Refresh your listings before deleting it.", code: "conflict", retryable: false,
    });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([Error, DeleteDraftError])("monitors unexpected %s messages without publishing them", async (ErrorClass) => {
    transaction.mockRejectedValue(new ErrorClass("postgres secret host details"));
    expect(await deleteMyDraft({ listingId: "draft", expectedRevision: 1 })).toMatchObject({
      error: JOURNEY_UNKNOWN_DESTRUCTIVE, code: "unknown", retryable: false,
    });
    expect(capture).toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
});
