import { describe, expect, it } from "vitest";
import { extractFranklinsListBoxes } from "@/scripts/dealer-stock-sync/connectors/named-html-more";
import { extractWebsiteDetailImages } from "@/scripts/dealer-stock-sync/html-media";

const origin = "https://www.franklins.co.im";

describe("Franklins live stock source regressions", () => {
  it("keeps Mike's gallery restricted to its own full-size stock photos", () => {
    const own = "https://images.clickdealer.co.uk/vehicles/7756/7756678/full/188305985.jpg";
    const other = "https://images.clickdealer.co.uk/vehicles/7756/7756679/full/188305986.jpg";
    expect(extractWebsiteDetailImages(`<img src="${own}"><img src="${other}">`, "https://www.mikesmotors.im", {
      dealerKey: "mikes-motors", detailUrl: "https://www.mikesmotors.im/used-car-7756678",
    })).toEqual([own]);
  });
  it("retains the stable identity and category of vans listed alongside cars", () => {
    const url = `${origin}/vans/renault/kangoomaxi/1.5-dci/1155033/`;
    const rows = extractFranklinsListBoxes(`<div class="list-box-wrapper">
      <h2><strong>RENAULT</strong> KANGOO MAXI</h2>
      <h3>Panel Van 1.5 dCi (2023)</h3><p>Cash Price £17,999 +VAT</p>
      <a class="view-car-details" href="${url}">View details</a></div>`, origin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url, sourceVehicleId: "1155033", vehicleType: "van" });
  });

  it("keeps reserved distinct from price on application", () => {
    const rows = extractFranklinsListBoxes(`<div class="list-box-wrapper">
      <h2><strong>HYUNDAI</strong> I10</h2><h3>Hatchback (2024)</h3>
      <p>RESERVED</p><a class="view-car-details"
      href="${origin}/cars/hyundai/i10/advance/1796235/">View details</a></div>`, origin);
    expect(rows[0]).toMatchObject({ availability: "reserved", isPoa: false });
  });

  it("extracts only this vehicle's original gallery images, excluding logos and other stock", () => {
    const photo = "https://img-uk3.cd5.uk/originals/2601/stockimages/1796235/photo_1796235.jpg?fm=webp";
    const other = "https://img-uk3.cd5.uk/originals/2601/stockimages/9999999/other.jpg?fm=webp";
    const html = `<img src="https://assets.cd5.uk/superadmin_uploads/photos/20_logo.png">
      <div id="slider-for" itemtype="http://schema.org/ImageGallery">
      <figure><a href="${photo}" class="item-slick" itemprop="contentUrl">
      <img src="${photo.replace("/photo_", "/w800/photo_")}" /></a></figure></div>
      <div class="related"><a href="${other}"><img src="${other}"></a></div>`;
    expect(extractWebsiteDetailImages(html, origin, {
      dealerKey: "franklins", detailUrl: `${origin}/cars/hyundai/i10/advance/1796235/`,
    }).map((url) => url.split("?")[0])).toEqual([photo.split("?")[0]]);
  });
});
