/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const expireAbandonedListingImageIntents = vi.fn();
const processListingImageCleanupJobs = vi.fn();

vi.mock("@/lib/listings/photo-cleanup", () => ({
  expireAbandonedListingImageIntents,
  processListingImageCleanupJobs,
}));

describe("PHOTO-ORPHAN-001 listing image cleanup cron", () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    expireAbandonedListingImageIntents.mockResolvedValue({ expired: 1 });
    processListingImageCleanupJobs.mockResolvedValue({ processed: 2 });
  });

  afterEach(() => {
    process.env.CRON_SECRET = previousSecret;
  });

  it("rejects requests without the cron bearer token", async () => {
    const { GET } = await import("@/app/api/cron/listing-image-cleanup/route");
    const response = await GET(new NextRequest("http://localhost:4000/api/cron/listing-image-cleanup"));
    expect(response.status).toBe(401);
    expect(expireAbandonedListingImageIntents).not.toHaveBeenCalled();
  });

  it("expires abandoned intents and processes cleanup jobs when authorized", async () => {
    const { GET } = await import("@/app/api/cron/listing-image-cleanup/route");
    const response = await GET(
      new NextRequest("http://localhost:4000/api/cron/listing-image-cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { expired: 1, processed: 2 },
    });
    expect(expireAbandonedListingImageIntents).toHaveBeenCalled();
    expect(processListingImageCleanupJobs).toHaveBeenCalledWith(50);
  });
});
