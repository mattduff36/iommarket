import { describe, expect, it } from "vitest";
import { buildViewerHash } from "@/lib/privacy/viewer-hash";

describe("viewer hash POL-PRIV-001", () => {
  it("skips tracking when the hash secret is missing", () => {
    expect(
      buildViewerHash({
        listingId: "listing-1",
        ip: "203.0.113.10",
        secret: null,
      }),
    ).toBeNull();
  });

  it("never stores a raw IP or user id", () => {
    const hashed = buildViewerHash({
      listingId: "listing-1",
      ip: "203.0.113.10",
      secret: "test-secret",
    });
    expect(hashed?.viewerHash.startsWith("v1:")).toBe(true);
    expect(hashed?.viewerHash).not.toContain("203.0.113.10");
    expect(hashed?.viewerHash).not.toContain("listing-1");

    const userHash = buildViewerHash({
      listingId: "listing-1",
      userId: "user-99",
      secret: "test-secret",
    });
    expect(userHash?.viewerHash).not.toContain("user-99");
    expect(userHash?.viewerHash).not.toEqual(hashed?.viewerHash);
  });
});
