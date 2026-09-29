import { describe, expect, it } from "vitest";
import {
  frozenImageQualityError,
  inspectFrozenImage,
} from "@/scripts/dealer-pack-audit-sync/image-quality";

describe("dealer pack frozen image quality", () => {
  it("reads PNG dimensions and accepts platform-sized images", () => {
    const bytes = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
    bytes.writeUInt32BE(1200, 16);
    bytes.writeUInt32BE(800, 20);

    const metadata = inspectFrozenImage(bytes);

    expect(metadata).toEqual({
      width: 1200,
      height: 800,
      format: "png",
      bytes: 24,
    });
    expect(frozenImageQualityError(metadata)).toBeNull();
  });

  it("rejects images below the platform dimensions", () => {
    const bytes = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
    bytes.writeUInt32BE(640, 16);
    bytes.writeUInt32BE(480, 20);

    expect(frozenImageQualityError(inspectFrozenImage(bytes))).toContain(
      "at least 800×480",
    );
  });

  it("rejects unknown or truncated image data", () => {
    expect(inspectFrozenImage(Buffer.from("not-an-image"))).toBeNull();
    expect(frozenImageQualityError(null)).toBe("unsupported-or-unreadable-image");
  });
});
