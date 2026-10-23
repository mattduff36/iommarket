/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { extractClickDealerListings } from "@/scripts/dealer-stock-sync/connectors/named-html-more";

describe("ClickDealer structured model identity", () => {
  it.each([
    ["PEUGEOT", "ELDDIS", "120 ACCORDO having only covered 7,800 miles! " + "Sales prose. ".repeat(30)],
    ["FORD", "ROLLER TEAM", "ZEFIRO 696 " + "Sales prose. ".repeat(30)],
    ["TOYOTA", "HI-LUX", "2.8 D-4D Invincible X Pickup Double Cab 4dr Diesel Auto 4WD Euro 6 (s/s) (204 ps)"],
    ["MERCEDES-BENZ", "COACHMAN", "Kabe 545"],
  ])("separates %s %s from sales text", (make, model, rest) => {
    const title = `2023 ${make} ${model} ${rest}`;
    const html = `<script>modelItems = [[60,17391,'${model}(1)']]\nfunction fillItems() {}</script>
      <div class="listing veh-123"><a href="/used-car-123"></a><div class="results-summary__title">${title}</div>
      <span class="results-spec__label">Year</span><span class="results-spec__stat">2023</span></div>`;
    const [car] = extractClickDealerListings(html, "https://dealer.example");
    expect(car?.make).toBe(make);
    expect(car?.model).toBe(model);
    expect(car?.description).toBe(title.trim());
    expect(car?.derivative).toBe(rest.length <= 120 ? rest : null);
  });
});
