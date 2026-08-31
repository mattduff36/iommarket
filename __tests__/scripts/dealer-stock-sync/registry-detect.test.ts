import { describe, expect, it } from "vitest";
import { detectConnector, getConnector } from "../../../scripts/dealer-stock-sync/connectors/detect";
import { DEALER_REGISTRY, getDealer } from "../../../scripts/dealer-stock-sync/registry";

describe("dealer registry", () => {
  it("contains the confirmed IOM operations plus unverified and specialist records", () => {
    const keys = DEALER_REGISTRY.map((item) => item.key);
    expect(keys).toContain("athol-garage");
    expect(keys).toContain("ocean-motor-village");
    expect(keys).toContain("automann");
    expect(keys).toContain("im8-vehicle-sales");
    expect(keys).toContain("mann-auto-car-sales");
    expect(keys).toContain("manx-motors");
    expect(keys).toContain("pextray");
    expect(getDealer("automann").status).toBe("no_public_site");
    expect(getDealer("im8-vehicle-sales").website).toBeNull();
    expect(getDealer("pextray").status).toBe("specialist_optional");
    expect(getDealer("ocean-motor-village").sources.map((item) => item.key)).toContain("ocean-citroen");
    expect(
      DEALER_REGISTRY.filter((item) => item.status === "confirmed" || item.status === "no_public_site"),
    ).toHaveLength(33);
  });

  it("configures Athol as NetDirector without a dealer-name branch", () => {
    const athol = getDealer("athol-garage");
    expect(athol.connectorKey).toBe("netdirector");
    expect(athol.sources.every((source) => source.connectorKey === "netdirector")).toBe(true);
    expect(getConnector(athol.connectorKey).key).toBe("netdirector");
  });
});

describe("connector detection", () => {
  it("detects known platforms from public fingerprints", () => {
    expect(detectConnector({ html: "Powered by NetDirector" })).toBe("netdirector");
    expect(detectConnector({ requestUrls: ["https://example.com/ajax/stock-listing/get-items"] })).toBe(
      "netdirector",
    );
    expect(detectConnector({ html: "Website powered by Click Dealer" })).toBe("click-dealer");
    expect(detectConnector({ html: "Designed & Powered by Dragon2000" })).toBe("dragon2000");
    expect(detectConnector({ html: "Autoweb Design" })).toBe("autoweb");
    expect(detectConnector({ html: "Dealer Websites" })).toBe("dealer-websites");
    expect(detectConnector({ html: "iomwebdesign" })).toBe("iomwebdesign");
    expect(detectConnector({ html: '<script type="application/ld+json">{}</script>' })).toBe("html-structured");
    expect(detectConnector({ url: "https://example.com/stock.csv" })).toBe("csv");
  });
});
