import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dealerPlaceholderBytes } from "@/lib/images/dealer-placeholder-bytes";

describe("iTrader replacement artwork", () => {
  it("uses the same trusted iTrader raster for placeholders from different dealers", async () => {
    const expected = await readFile("public/images/placeholder-listing.png");
    for (const url of ["https://www.manxcarwarehouse.im/dist/img/default/no-pic.jpg", "https://other-dealer.example/noimage.png"]) {
      const result = await dealerPlaceholderBytes(url);
      expect(result?.contentType).toBe("image/png");
      expect(result?.bytes).toEqual(expected);
      expect(await sharp(result!.bytes).metadata()).toMatchObject({ width: 1200, height: 900, format: "png" });
    }
  });
  it("leaves real photos on the normal secure download path", async () => {
    expect(await dealerPlaceholderBytes("https://dealer.example/stock/audi.jpg")).toBeNull();
  });
});
