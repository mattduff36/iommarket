/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { extractDealerWebsitesCards } from "@/scripts/dealer-stock-sync/connectors/named-html-more";
import { parseGenericVehicle } from "@/scripts/dealer-stock-sync/connectors/website-source";
const card = (price: string) => `<div class="vehicle-make-model"><a href="https://dealer.example/vehicle/abc123">
  <h2 class="make-model">Peugeot 3008</h2><span class="derivative">2017 - Active</span></a>
  <p>Only £65 road tax</p><span class="vehicle-price"><span class="totalPrice g5">${price}</span></span></div>`;
describe("Dealer Websites stock cards", () => {
  it("identifies sold stock and never treats road tax as its price", () => {
    const [car] = extractDealerWebsitesCards(card("Sold"), "https://dealer.example");
    expect(car?.availability).toBe("sold");
    expect(car?.price).toBeNull();
  });
  it("uses only the selling price element", () => {
    const [car] = extractDealerWebsitesCards(card("£9,995"), "https://dealer.example");
    expect(car?.availability).toBe("available");
    expect(car?.price).toBe(9995);
    expect(parseGenericVehicle(car, "https://dealer.example")?.availability).toBe("available");
  });
});
