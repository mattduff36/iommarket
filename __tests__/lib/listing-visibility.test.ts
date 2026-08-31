import { describe, expect, it } from "vitest";
import {
  canInspectPendingRevision,
  canViewListing,
  isListingEditable,
  isListingPubliclyVisible,
} from "@/lib/listings/visibility";

describe("listing visibility ALR-VIS-001", () => {
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

  it("shows enabled preview listings only to admins", () => {
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: null,
        previewPackEnabled: true,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "buyer", role: "USER" },
        previewPackEnabled: true,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "preview-owner", role: "DEALER" },
        previewPackEnabled: true,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "admin", role: "ADMIN" },
        previewPackEnabled: false,
      }),
    ).toBe(false);
    expect(
      canViewListing({
        status: "ADMIN_PREVIEW",
        expiresAt: null,
        listingUserId: "preview-owner",
        viewer: { id: "admin", role: "ADMIN" },
        previewPackEnabled: true,
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
