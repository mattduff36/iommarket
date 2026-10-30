import { describe, expect, it } from "vitest";
import { extractSnccOverview } from "@/scripts/dealer-stock-sync/connectors/sncc-overview";
describe("SNCC vehicle overview", () => {
  it("reads vehicle prose and explicit motorcycle identity, excluding forms", () => {
    const html = '<form>Social security number</form><div class="tab-pane active" id="tab-overview"><p>SkillanNaylor Car (motorcycle) Company are pleased to offer this Honda VTR 1000.</p><p>Original paint.</p></div><footer>Other inventory</footer>';
    expect(extractSnccOverview(html)).toEqual({ description: "SkillanNaylor Car (motorcycle) Company are pleased to offer this Honda VTR 1000. Original paint.", vehicleType: "motorcycle" });
  });
  it("recognises an explicit description of this vehicle as a pickup", () => {
    expect(extractSnccOverview('<div id="tab-overview">A rear camera makes manoeuvring this substantial pick-up easier.</div>')?.vehicleType).toBe("van");
    expect(extractSnccOverview('<div id="tab-overview">We also sell pickups and motorcycles.</div>')?.vehicleType).toBeNull();
  });
  it("bounds descriptions to the desktop contract and does not infer a motorcycle from navigation", () => {
    expect(extractSnccOverview('<nav>motorcycle</nav><div id="tab-overview">' + 'Car '.repeat(2000) + '</div>')).toEqual({ description: ('Car '.repeat(2000)).trim().slice(0, 4000), vehicleType: null });
    expect(extractSnccOverview('<footer>motorcycle</footer>')).toBeNull();
  });
});
