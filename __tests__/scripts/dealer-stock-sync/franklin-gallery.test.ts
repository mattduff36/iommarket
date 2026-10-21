import { describe, expect, it } from "vitest";
import { extractWebsiteDetailImages } from "../../../scripts/dealer-stock-sync/html-media";

const origin = "https://www.franklins.co.im";
const detailUrl = `${origin}/cars/hyundai/i10/1.2-i10-advance-1.2-84ps-my24/1796235/`;

describe("Franklins detail gallery", () => {
  it("keeps only this vehicle's cd5 stock images from the representative gallery markup", () => {
    const html = `<a href="https://img-uk3.cd5.uk/originals/2601/stockimages/1796235/photo.jpg"><img src="https://img-uk3.cd5.uk/originals/2601/stockimages/1796235/w800/photo.jpg"></a><img src="https://img-uk3.cd5.uk/originals/2601/stockimages/9999999/other.jpg">`;
    const images = extractWebsiteDetailImages(html, origin, {
      dealerKey: "franklins",
      detailUrl,
    });
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      const path = new URL(image).pathname.toLowerCase();
      expect(path).toContain("/stockimages/1796235/");
      expect(path).not.toContain("logo");
      expect(path).not.toMatch(/\/w\d+\//);
    }
  });

  it("returns no photos when the page has logos or another vehicle's stock images only", () => {
    const html = `<img src="https://assets.cd5.uk/superadmin_uploads/photos/20_logo.png">
      <a href="https://img-uk3.cd5.uk/originals/2601/stockimages/9999999/other.jpg">
      <img src="https://img-uk3.cd5.uk/originals/2601/stockimages/9999999/other.jpg"></a>`;
    expect(
      extractWebsiteDetailImages(html, origin, { dealerKey: "franklins", detailUrl }),
    ).toEqual([]);
    expect(
      extractWebsiteDetailImages(html, origin, { dealerKey: "franklins", detailUrl: null }),
    ).toEqual([]);
  });
});
