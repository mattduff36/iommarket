import { describe, expect, it } from "vitest";
import {
  assertNotOceanDealerProfile,
  assertPreviewDealerAllowed,
  isExcludedPreviewDealerKey,
  isPreviewSystemAuthUserId,
  isPreviewSystemEmail,
  isProtectedPreviewOwnerEmail,
  previewSystemAuthUserId,
  previewSystemEmail,
} from "@/lib/preview-packs/safety";

describe("preview pack safety", () => {
  it("allows Ocean Motor Village as a normal pack and still excludes other Ocean brands", () => {
    expect(isExcludedPreviewDealerKey("ocean-motor-village", "ocean")).toBe(false);
    expect(isExcludedPreviewDealerKey("ocean-ford", "ocean")).toBe(true);
    expect(isExcludedPreviewDealerKey("athol-garage", null)).toBe(false);
    expect(() =>
      assertPreviewDealerAllowed({
        dealerKey: "ocean-motor-village",
        displayName: "Ocean Motor Village",
        groupKey: "ocean",
      }),
    ).not.toThrow();
  });

  it("protects the Ocean owner email and refuses attaching to the live Ocean dealer", () => {
    expect(isProtectedPreviewOwnerEmail("mattduff36@gmail.com")).toBe(true);
    expect(() =>
      assertPreviewDealerAllowed({
        dealerKey: "ocean-motor-village",
        ownerEmail: "mattduff36@gmail.com",
      }),
    ).toThrow(/Ocean owner/);
    expect(() =>
      assertPreviewDealerAllowed({
        dealerKey: "athol-garage",
        ownerEmail: "mattduff36@gmail.com",
      }),
    ).toThrow(/Ocean owner/);
    expect(previewSystemEmail("athol-garage")).not.toContain("mattduff36");
    expect(previewSystemAuthUserId("athol-garage")).toBe("preview-system:athol-garage");
    expect(isPreviewSystemEmail("preview+pextray@preview.internal")).toBe(true);
    expect(isPreviewSystemEmail("sales@manxmotors.im")).toBe(false);
    expect(isPreviewSystemAuthUserId("preview-system:pextray")).toBe(true);
    expect(isPreviewSystemAuthUserId("auth0|real-user")).toBe(false);
    expect(() =>
      assertNotOceanDealerProfile({
        dealerId: "ocean-dealer-id",
        oceanDealerId: "ocean-dealer-id",
      }),
    ).toThrow(/Ocean dealer profile/);
    expect(() =>
      assertNotOceanDealerProfile({
        dealerId: "preview-dealer-id",
        oceanDealerId: "ocean-dealer-id",
      }),
    ).not.toThrow();
  });
});
