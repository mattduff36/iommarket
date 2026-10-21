import { describe, expect, it } from "vitest";
import { extractWebsiteDetailImages } from "../../../scripts/dealer-stock-sync/html-media";

const origin = "https://www.franklins.co.im";
const detailUrl = `${origin}/cars/hyundai/i10/1.2-i10-advance-1.2-84ps-my24/1796235/`;

describe("Franklins detail gallery", () => {
  it("does not import a dealer placeholder when the current Mazda has no source photos", () => {
    // Reduced from the public Mazda detail page observed 2026-10-16.
    const html = `<script type="application/ld+json">{"@type":"Vehicle","image":""}</script>
      <div class="slider-for" id="slider-for">
        <a href="/asset/images/noimage.jpg" class="item-slick"><img src="/asset/images/noimage.jpg" alt="MAZDA MAZDA2" /></a>
      </div><input type="hidden" name="pg_car_image" value="">`;
    expect(extractWebsiteDetailImages(html, origin, {
      dealerKey: "franklins",
      detailUrl: `${origin}/cars/mazda/mazda2/1.5-skyactiv-g-gt-sport-nav+/1933318/`,
    })).toEqual([]);
  });

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
