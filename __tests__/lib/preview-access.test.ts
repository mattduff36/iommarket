import { describe, expect, it } from "vitest";
import {
  PREVIEW_ACCESS_PATH,
  resolvePreviewAccessPath,
} from "@/lib/preview-access";

describe("resolvePreviewAccessPath", () => {
  it("allows the public preview page", () => {
    expect(resolvePreviewAccessPath(PREVIEW_ACCESS_PATH)).toEqual({
      action: "allow",
    });
  });

  it("redirects the old /dev and /dev/auth URLs to /preview", () => {
    expect(resolvePreviewAccessPath("/dev")).toEqual({
      action: "redirect",
      to: "/preview",
    });
    expect(resolvePreviewAccessPath("/dev/auth")).toEqual({
      action: "redirect",
      to: "/preview",
    });
  });

  it("leaves unrelated paths to the rest of middleware", () => {
    expect(resolvePreviewAccessPath("/")).toBeNull();
    expect(resolvePreviewAccessPath("/sign-in")).toBeNull();
    expect(resolvePreviewAccessPath("/admin")).toBeNull();
  });
});
