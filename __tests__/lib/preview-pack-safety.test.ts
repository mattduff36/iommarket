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
  it("excludes Ocean keys and group members", () => {
    expect(isExcludedPreviewDealerKey("ocean-motor-village", null)).toBe(true);
    expect(isExcludedPreviewDealerKey("ocean-ford", "ocean")).toBe(true);
    expect(isExcludedPreviewDealerKey("athol-garage", null)).toBe(false);
  });

  it("protects the Ocean owner email and refuses Ocean materialize", () => {
    expect(isProtectedPreviewOwnerEmail("mattduff36@gmail.com")).toBe(true);
    expect(() =>
      assertPreviewDealerAllowed({ dealerKey: "ocean-motor-village" }),
    ).toThrow(/Ocean Motor Village/);
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
