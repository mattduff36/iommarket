import { describe, expect, it } from "vitest";
import {
  canInspectPendingRevision,
  canViewListing,
  isListingEditable,
  isListingPubliclyVisible,
} from "@/lib/listings/visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

describe("listing visibility ALR-VIS-001", () => {
  it("hides revoked dealer stock from buyers while retaining owner/admin inspection", () => {
    const listing = { status: "LIVE" as const, expiresAt: null, listingUserId: "owner", dealerAccess: false };
    expect(isListingPubliclyVisible(listing)).toBe(false);
    expect(canViewListing({ ...listing, viewer: null })).toBe(false);
    expect(canViewListing({ ...listing, viewer: { id: "buyer", role: "USER" } })).toBe(false);
    expect(canViewListing({ ...listing, viewer: { id: "owner", role: "DEALER" } })).toBe(true);
    expect(canViewListing({ ...listing, viewer: { id: "admin", role: "ADMIN" } })).toBe(true);
    expect(isListingPubliclyVisible({ ...listing, dealerAccess: true })).toBe(true);
    expect(isListingPubliclyVisible({ ...listing, status: "EXPIRED", dealerAccess: true })).toBe(false);
  });
  it("keeps draft pending rejected and taken-down listings off the public web", () => {
    for (const status of ["DRAFT", "PENDING", "REJECTED", "TAKEN_DOWN", "EXPIRED"] as const) {
      expect(
        isListingPubliclyVisible({ status, expiresAt: new Date(Date.now() + 60_000) }),
      ).toBe(false);
    }
    expect(
      isListingPubliclyVisible({
        status: "LIVE",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe(true);
    expect(isListingPubliclyVisible({ status: "SOLD", expiresAt: null })).toBe(true);
    expect(
      isListingPubliclyVisible({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
      }),
    ).toBe(false);
  });

  it("hides preview listings from everyone on production, including admins and dirty live rows", () => {
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "admin", role: "ADMIN" },
        previewPackEnabled: true,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "LIVE",
        expiresAt: null,
        listingUserId: "preview-owner",
        dealerAccess: true,
        previewPackId: "pack-1",
        dealerIsAdminPreview: true,
        ownerAuthUserId: "preview-system:athol-garage",
        viewer: { id: "admin", role: "ADMIN" },
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "LIVE",
        expiresAt: null,
        listingUserId: "preview-owner",
        dealerAccess: true,
        ownerEmail: "preview+athol-garage@preview.internal",
        viewer: null,
      }),
    ).toBe(false);
  });

  it("shows preview listings only to verified staging admins, including disabled packs", () => {
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: null,
        previewPackEnabled: true,
        env: verifiedStagingEnv,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "buyer", role: "USER" },
        previewPackEnabled: true,
        env: verifiedStagingEnv,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "preview-owner", role: "DEALER" },
        previewPackEnabled: true,
        env: verifiedStagingEnv,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "admin", role: "ADMIN" },
        previewPackEnabled: false,
        env: verifiedStagingEnv,
      }),
    ).toBe(true);
    expect(
      canViewListing({
        status: "LIVE",
        expiresAt: null,
        listingUserId: "preview-owner",
        dealerAccess: true,
        previewPackId: "pack-1",
        viewer: { id: "admin", role: "ADMIN" },
        env: verifiedStagingEnv,
      }),
    ).toBe(true);
  });

  it("lets owners and admins inspect moderated listings ALR-VIS-002", () => {
    expect(
      canViewListing({
        status: "TAKEN_DOWN",
        expiresAt: null,
        listingUserId: "owner",
        viewer: { id: "owner", role: "USER" },
      }),
    ).toBe(true);
    expect(
      canViewListing({
        status: "REJECTED",
        expiresAt: null,
        listingUserId: "owner",
        viewer: { id: "admin", role: "ADMIN" },
      }),
    ).toBe(true);
    expect(
      canViewListing({
        status: "REJECTED",
        expiresAt: null,
        listingUserId: "owner",
        viewer: { id: "stranger", role: "USER" },
      }),
    ).toBe(false);
  });

  it("allows owner edits for draft expired live taken-down and rejected listings", () => {
    expect(isListingEditable("DRAFT")).toBe(true);
    expect(isListingEditable("LIVE")).toBe(true);
    expect(isListingEditable("TAKEN_DOWN")).toBe(true);
    expect(isListingEditable("REJECTED")).toBe(true);
    expect(isListingEditable("PENDING")).toBe(false);
    expect(isListingEditable("SOLD")).toBe(false);
    expect(isListingEditable("ADMIN_PREVIEW")).toBe(false);
  });

  it("only lets an explicitly requested admin review fetch a live pending revision UI-REV-001", () => {
    expect(
      canInspectPendingRevision({
        status: "LIVE",
        reviewRequested: true,
        viewer: { role: "ADMIN" },
      }),
    ).toBe(true);
    expect(
      canInspectPendingRevision({
        status: "LIVE",
        reviewRequested: true,
        viewer: { role: "USER" },
      }),
    ).toBe(false);
    expect(
      canInspectPendingRevision({
        status: "LIVE",
        reviewRequested: false,
        viewer: { role: "ADMIN" },
      }),
    ).toBe(false);
    expect(
      canInspectPendingRevision({
        status: "TAKEN_DOWN",
        reviewRequested: true,
        viewer: { role: "ADMIN" },
      }),
    ).toBe(false);
  });
});
