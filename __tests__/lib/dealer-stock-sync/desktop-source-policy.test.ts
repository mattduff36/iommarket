import { describe, expect, it } from "vitest";
import {
  assertDesktopSourceUrl,
  desktopDetailUrlRules,
  desktopImageUrlRules,
  DesktopSourcePolicyError,
} from "@/lib/dealer-stock-sync/desktop-source-policy";

const MIKE = "https://www.mikesmotors.im/used-cars";
const CDN = "https://images.clickdealer.co.uk/vehicles/8324/8324646/full/204251334.jpg";

describe("assertDesktopSourceUrl", () => {
  it("allows the configured Mike source host and the Click Dealer CDN", () => {
    const images = desktopImageUrlRules("mikes-motors", "click-dealer", MIKE);
    const details = desktopDetailUrlRules(MIKE);

    expect(assertDesktopSourceUrl(CDN, images)).toBe(CDN);
    expect(assertDesktopSourceUrl("https://www.mikesmotors.im/photos/fiesta.jpg", images)).toBe(
      "https://www.mikesmotors.im/photos/fiesta.jpg",
    );
    expect(assertDesktopSourceUrl(`${MIKE}/ford-fiesta-8324646`, details)).toBe(`${MIKE}/ford-fiesta-8324646`);
  });

  it("rejects foreign hosts, credentials, ports, IP addresses, and private hosts", () => {
    const images = desktopImageUrlRules("mikes-motors", "click-dealer", MIKE);
    const rejected = [
      "https://cdn.example/ford.jpg",
      "https://mikesmotors.im/photos/fiesta.jpg",
      "https://images.clickdealer.co.uk.evil.example/a.jpg",
      "http://images.clickdealer.co.uk/a.jpg",
      "https://user:pass@images.clickdealer.co.uk/a.jpg",
      "https://images.clickdealer.co.uk:8443/a.jpg",
      "https://8.8.8.8/a.jpg",
      "https://192.168.0.8/a.jpg",
      "https://[::1]/a.jpg",
      "https://localhost/a.jpg",
      "https://photos.local/a.jpg",
      "file:///C:/stock/a.jpg",
      "C:\\Users\\stock\\a.jpg",
    ];

    for (const url of rejected) {
      expect(() => assertDesktopSourceUrl(url, images)).toThrow(DesktopSourcePolicyError);
    }
  });

  it("limits shared photo CDNs to the documented host and path", () => {
    const netdirector = desktopImageUrlRules("athol-garage", "netdirector", "https://www.athol.im/used-cars/");
    const dragon = desktopImageUrlRules("bvs-vehicles", "dragon2000", "https://bvsvehicles.com/our-vehicles/");
    const franklin = desktopImageUrlRules("franklins", "html-structured", "https://www.franklins.co.im/used/cars/port-erin/");
    const swift = desktopImageUrlRules("swift-motors", "html-structured", "https://swiftmotors.net/used-vehicles/");

    expect(assertDesktopSourceUrl("https://images.netdirector.auto/token", netdirector)).toBe(
      "https://images.netdirector.auto/token",
    );
    expect(
      assertDesktopSourceUrl("https://s3-eu-west-1.amazonaws.com/autofs/ndstock/images/a.jpg", netdirector),
    ).toBe("https://s3-eu-west-1.amazonaws.com/autofs/ndstock/images/a.jpg");
    expect(() => assertDesktopSourceUrl("https://s3-eu-west-1.amazonaws.com/other-bucket/a.jpg", netdirector)).toThrow(
      DesktopSourcePolicyError,
    );
    expect(assertDesktopSourceUrl("https://img.cdn.dragon2000.net/stock/a.jpg", dragon)).toContain("dragon2000.net");
    expect(assertDesktopSourceUrl("https://img-uk3.cd5.uk/originals/2601/stockimages/1/a.jpg", franklin)).toContain("cd5.uk");
    expect(() => assertDesktopSourceUrl("https://img-uk9.cd5.uk/originals/a.jpg", franklin)).toThrow(DesktopSourcePolicyError);
    expect(assertDesktopSourceUrl("https://bluesky.cdn.imgeng.in/cogstock-images/a.jpg", swift)).toContain("imgeng.in");
    expect(() => assertDesktopSourceUrl("https://bluesky.cdn.imgeng.in/other/a.jpg", swift)).toThrow(DesktopSourcePolicyError);
  });
});
