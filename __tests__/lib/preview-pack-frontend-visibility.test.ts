import { describe, expect, it } from "vitest";
import {
  canExposePreviewPacksToViewer,
  excludePreviewPackDealersWhere,
  excludePreviewPackListingsWhere,
  excludePreviewPackUsersWhere,
  isPreviewPackDealer,
  isPreviewPackListing,
  isPreviewPackUser,
  linkedPreviewPackListingWhere,
  previewPacksVisibleOnFrontend,
  productionPreviewListingViewSql,
} from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

const entitledPreviewDealer = {
  isAdminPreview: true,
  authUserId: "preview-system:athol-garage",
  email: "preview+athol-garage@preview.internal",
};

describe("preview pack frontend boundary", () => {
  it("fails closed unless every verified staging identity is present", () => {
    expect(previewPacksVisibleOnFrontend(verifiedStagingEnv)).toBe(true);
    expect(previewPacksVisibleOnFrontend({
      ...verifiedStagingEnv,
      VERCEL_ENV: "production",
    })).toBe(false);
    expect(canExposePreviewPacksToViewer({
      viewer: { role: "ADMIN" },
      env: verifiedStagingEnv,
    })).toBe(true);
    expect(canExposePreviewPacksToViewer({
      viewer: { role: "ADMIN" },
    })).toBe(false);
    expect(canExposePreviewPacksToViewer({
      viewer: { role: "USER" },
      env: verifiedStagingEnv,
    })).toBe(false);
  });

  it("recognises every durable preview identity, including dirty live rows", () => {
    expect(isPreviewPackDealer(entitledPreviewDealer)).toBe(true);
    expect(isPreviewPackDealer({
      isAdminPreview: false,
      authUserId: "preview-system:athol-garage",
    })).toBe(true);
    expect(isPreviewPackUser({
      email: "Preview+Athol@Preview.Internal",
    })).toBe(true);
    expect(isPreviewPackUser({
      authUserId: "real-user",
      email: "dealer@example.com",
    })).toBe(false);
    expect(isPreviewPackListing({
      status: "LIVE",
      previewPackId: "pack-1",
    })).toBe(true);
    expect(isPreviewPackListing({
      status: "LIVE",
      dealerIsAdminPreview: true,
    })).toBe(true);
    expect(isPreviewPackListing({
      status: "LIVE",
      ownerEmail: "preview+athol-garage@preview.internal",
    })).toBe(true);
    expect(isPreviewPackListing({
      status: "LIVE",
      previewPackId: null,
    })).toBe(false);
  });

  it("builds production exclusions for dealers, users, listings and subscriptions", () => {
    expect(excludePreviewPackDealersWhere()).toMatchObject({ isAdminPreview: false });
    expect(JSON.stringify(excludePreviewPackUsersWhere())).toContain("preview.internal");
    expect(excludePreviewPackListingsWhere()).toMatchObject({
      previewPackId: null,
      status: { not: "ADMIN_PREVIEW" },
    });
    expect(linkedPreviewPackListingWhere()).toMatchObject({
      status: { not: "ADMIN_PREVIEW" },
    });
    expect(productionPreviewListingViewSql()).not.toBeNull();
    expect(productionPreviewListingViewSql(verifiedStagingEnv)).toBeNull();
  });
});
