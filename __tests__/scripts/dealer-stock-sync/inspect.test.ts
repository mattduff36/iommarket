import { describe, expect, it } from "vitest";
import { countPriceLikeCards, detectBlockedPage, detectFacebookRedirect } from "../../../scripts/dealer-stock-sync/inspect/cards";
import { concludeFromPages, serializeInspectEvidence, type DealerInspectEvidence } from "../../../scripts/dealer-stock-sync/inspect/evidence";
import { pickInspectTargets } from "../../../scripts/dealer-stock-sync/inspect/run";
import { rankStockLinks, scoreStockLink, shouldInspectDealer } from "../../../scripts/dealer-stock-sync/inspect/links";
import { dealerFixture } from "./fixtures";

describe("inspect link ranking", () => {
  it("scores in-domain stock links and rejects login or social", () => {
    expect(scoreStockLink("/used-cars/", "Used cars", "https://example.com/")).toBeGreaterThan(0);
    expect(scoreStockLink("https://example.com/login", "Login", "https://example.com/")).toBeNull();
    expect(scoreStockLink("https://facebook.com/dealer", "Facebook", "https://example.com/")).toBeNull();
    const ranked = rankStockLinks(
      [
        { href: "/about", text: "About" },
        { href: "/used-cars/", text: "Used stock" },
        { href: "/contact", text: "Contact" },
      ],
      "https://example.com/",
      new Set(),
    );
    expect(ranked[0]?.href).toContain("/used-cars/");
  });
});

describe("inspect card and block detection", () => {
  it("counts price-like cards near a year or make", () => {
    const html = `<h2>2019 Fiat 500</h2><p>£7,695</p><h2>Ford Focus</h2><span>£12,995</span>`;
    expect(countPriceLikeCards(html).count).toBeGreaterThanOrEqual(2);
  });

  it("detects captcha and facebook redirects", () => {
    expect(detectBlockedPage({ title: "Just a moment...", html: "cloudflare", status: 200 })).toBe(
      "blocked_requires_feed",
    );
    expect(detectFacebookRedirect("https://www.facebook.com/vehicles.im/")).toBe(true);
  });
});

describe("inspect target selection and evidence", () => {
  it("inspects zeros and partials, skips known-good and no-url", () => {
    expect(shouldInspectDealer({ dealerKey: "athol-garage", uniqueVehicles: 64, hasUrl: true }).inspect).toBe(false);
    expect(shouldInspectDealer({ dealerKey: "ingear-car-sales", uniqueVehicles: 6, hasUrl: true }).kind).toBe("partial");
    expect(shouldInspectDealer({ dealerKey: "franklins", uniqueVehicles: 0, hasUrl: true }).kind).toBe("zero");
    expect(shouldInspectDealer({ dealerKey: "automann", uniqueVehicles: 0, hasUrl: false }).inspect).toBe(false);
  });

  it("picks inspect targets from archive summaries", () => {
    const targets = pickInspectTargets(
      [
        dealerFixture({ key: "athol-garage", website: "https://www.athol.im/" }),
        dealerFixture({ key: "franklins", website: "https://www.franklins.co.im/", stockUrls: ["https://www.franklins.co.im/"] }),
        dealerFixture({ key: "ingear-car-sales", website: "https://www.ingearcarsales.co.uk/" }),
      ],
      [
        { dealerKey: "athol-garage", uniqueVehicles: 64, importable: 64 },
        { dealerKey: "franklins", uniqueVehicles: 0, importable: 0 },
        { dealerKey: "ingear-car-sales", uniqueVehicles: 6, importable: 0 },
      ],
    );
    expect(targets.map((item) => item.dealer.key)).toEqual(["franklins", "ingear-car-sales"]);
  });

  it("serializes evidence and concludes from visible cards", () => {
    const evidence: DealerInspectEvidence = {
      dealerKey: "franklins",
      displayName: "Franklins",
      connectorKey: "html-structured",
      archiveUnique: 0,
      archiveImportable: 0,
      kind: "zero",
      skipReason: null,
      conclusion: "",
      suggestedStockUrls: [],
      clickedHrefs: [],
      pages: [
        {
          url: "https://www.franklins.co.im/",
          title: "Used cars",
          screenshotRel: "shots/00.png",
          priceLikeCards: 6,
          priceSamples: ["2019 Fiat £7695"],
          jsonUrls: [],
          blocked: false,
          facebook: false,
          error: null,
        },
      ],
      maxVisibleCards: 6,
      jsonPayloadCount: 0,
    };
    expect(concludeFromPages(evidence)).toBe("public_list_visible");
    expect(serializeInspectEvidence(evidence)).toContain("franklins");
  });
});
