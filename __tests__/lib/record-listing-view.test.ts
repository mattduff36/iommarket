import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { recordListingView } from "@/lib/listings/record-view";

const input = { listingId: "listing-id", viewerId: "viewer", viewerHash: "hash", viewerHashVersion: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue(1);
  mocks.create.mockResolvedValue({ id: "view" });
  mocks.transaction.mockImplementation(async work => work({
    $executeRaw: mocks.execute, listingView: { create: mocks.create },
  }));
});

describe("listing view analytics", () => {
  it("increments only the counter without invalidating stock timestamps or overwriting concurrent edits", async () => {
    await recordListingView(input);
    const [strings, listingId] = mocks.execute.mock.calls[0];
    expect(strings.join("?").trim()).toBe('UPDATE "Listing" SET "viewCount" = "viewCount" + 1 WHERE "id" = ?');
    expect(listingId).toBe(input.listingId);
    expect(mocks.create).toHaveBeenCalledWith({ data: input });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps listing IDs as query parameters", async () => {
    const listingId = "id'; UPDATE Listing SET price=0; --";
    await recordListingView({ ...input, listingId });
    expect(mocks.execute.mock.calls[0][0].join("")).not.toContain(listingId);
    expect(mocks.execute.mock.calls[0][1]).toBe(listingId);
  });

  it("does not create an orphan view if the listing disappeared", async () => {
    mocks.execute.mockResolvedValue(0);
    await expect(recordListingView(input)).rejects.toThrow("Listing unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("propagates event failure out of the transaction so the counter rolls back", async () => {
    mocks.create.mockRejectedValue(new Error("event failed"));
    await expect(recordListingView({ ...input, viewerId: undefined })).rejects.toThrow("event failed");
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("event failed");
  });
});
