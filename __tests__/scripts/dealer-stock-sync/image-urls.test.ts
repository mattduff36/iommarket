import { describe, expect, it } from "vitest";
import { parseNetDirectorVehicle } from "../../../scripts/dealer-stock-sync/connectors/netdirector/normalize";
import { extractGalleryFromHtml as extractDealerHtml } from "../../../scripts/dealer-stock-sync/html-media";
import {
  canonicalizeImageUrl,
  encodeNetDirectorImageUrl,
  uniqueImageUrls,
} from "../../../scripts/dealer-stock-sync/image-urls";
import { uniqueImageUrls as oceanUniqueImageUrls } from "../../../scripts/import-ocean-inventory/map-vehicle";
import { extractGalleryFromHtml as extractOceanHtml } from "../../../scripts/import-ocean-inventory/classic";
import { normalizeNetDirectorVehicle } from "../../../scripts/import-ocean-inventory/normalize";
import { previewImageSources } from "../../../lib/preview-packs/upload";

function ndUrl(key: string, width?: number) {
  return encodeNetDirectorImageUrl(
    width
      ? { key, edits: { resize: { width } } }
      : { key },
  );
}

describe("ND-IMG-001 NetDirector key variants", () => {
  it("keeps the unresized original when 400 and 800 variants share a key", () => {
    const urls = uniqueImageUrls([ndUrl("ndstock/a.jpg", 400), ndUrl("ndstock/a.jpg", 800)]);
    expect(urls).toEqual([canonicalizeImageUrl(ndUrl("ndstock/a.jpg", 800))]);
    expect(urls).toHaveLength(1);
    expect(uniqueImageUrls([ndUrl("ndstock/a.jpg", 800), ndUrl("ndstock/a.jpg")])).toEqual([
      canonicalizeImageUrl(ndUrl("ndstock/a.jpg")),
    ]);
  });
});

describe("ND-IMG-002 S3 original vs CDN token", () => {
  it("collapses S3 original and CDN token for the same key and prefers S3", () => {
    const s3 = "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/a.jpg";
    const urls = uniqueImageUrls([s3, ndUrl("ndstock/a.jpg", 400)]);
    expect(urls).toEqual([s3]);
  });
});

describe("ND-IMG-003 WordPress -WxH thumbs", () => {
  it("drops a resized sibling without collapsing unrelated photos", () => {
    expect(
      uniqueImageUrls([
        "https://sncc.im/wp-content/uploads/2026/08/IMG_1038-876x535.jpeg",
        "https://sncc.im/wp-content/uploads/2026/08/IMG_1038.jpeg",
        "https://sncc.im/wp-content/uploads/2026/08/IMG_1049.jpeg",
      ]),
    ).toEqual([
      "https://sncc.im/wp-content/uploads/2026/08/IMG_1038.jpeg",
      "https://sncc.im/wp-content/uploads/2026/08/IMG_1049.jpeg",
    ]);
  });

  it("does not collapse distinct hosts that reuse the same image path", () => {
    expect(
      uniqueImageUrls([
        "https://dealer-one.example/images/vehicle.jpg",
        "https://dealer-two.example/images/vehicle.jpg",
      ]),
    ).toEqual([
      "https://dealer-one.example/images/vehicle.jpg",
      "https://dealer-two.example/images/vehicle.jpg",
    ]);
  });
});

describe("ND-IMG-004 collectImages field priority", () => {
  it("prefers original then large over url and src", () => {
    const raw = {
      id: "1",
      manufacturer: "SEAT",
      model: "Ibiza",
      images: [
        {
          src: "https://cdn.example/thumb.jpg",
          url: "https://cdn.example/card.jpg",
          large: "https://cdn.example/large.jpg",
          original: "https://cdn.example/original.jpg",
        },
      ],
    };
    expect(parseNetDirectorVehicle(raw)?.imageUrls).toEqual(["https://cdn.example/original.jpg"]);
    expect(
      normalizeNetDirectorVehicle(
        {
          ...raw,
          make: "SEAT",
        },
        "ocean-ford",
        "https://www.oceanford.com",
      )?.imageUrls,
    ).toEqual(["https://cdn.example/original.jpg"]);
  });
});

describe("ND-IMG-005 API plus HTML overlapping thumbs", () => {
  it("does not duplicate the first four photos and keeps later canonical large URLs under the 20 cap", () => {
    const api = [
      "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/1.jpg",
      "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/2.jpg",
      "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/3.jpg",
      "https://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/4.jpg",
    ];
    const html = [
      ndUrl("ndstock/1.jpg", 400),
      ndUrl("ndstock/2.jpg", 400),
      ndUrl("ndstock/3.jpg", 400),
      ndUrl("ndstock/4.jpg", 400),
      ...Array.from({ length: 16 }, (_, index) => ndUrl(`ndstock/${index + 5}.jpg`, 400)),
    ];
    const urls = uniqueImageUrls([...api, ...html]);
    expect(urls).toHaveLength(20);
    expect(urls.slice(0, 4)).toEqual(api);
    expect(urls.slice(4)).toEqual(
      Array.from({ length: 16 }, (_, index) => canonicalizeImageUrl(ndUrl(`ndstock/${index + 5}.jpg`))),
    );
  });
});

describe("PREVIEW-IMG-001 size-variant families", () => {
  it("collapses Rex /thumb/, Dragon suffixes, SMG size dirs, ImageEngine width, and t_ thumbs", () => {
    expect(
      uniqueImageUrls([
        "https://s3.example/rexmotors/thumb/img_2770.jpeg",
        "https://s3.example/rexmotors/img_2770.jpeg",
        "https://img.cdn.dragon2000.net/C3656/U2266/IMG_1200-mini.jpg",
        "https://img.cdn.dragon2000.net/C3656/U2266/IMG_1200-large.jpg",
        "https://smgmedia.blob.core.windows.net/images/129757/320/car.jpg",
        "https://smgmedia.blob.core.windows.net/images/129757/1920/car.jpg",
        "https://bluesky.cdn.imgeng.in/cogstock-images/motors-aaa.jpg?imgeng=/w_500/",
        "https://bluesky.cdn.imgeng.in/cogstock-images/motors-aaa.jpg",
        "https://api.dealerwebsites.co.uk/t_abc123.jpg",
        "https://api.dealerwebsites.co.uk/abc123.jpg",
      ]),
    ).toEqual([
      "https://s3.example/rexmotors/img_2770.jpeg",
      "https://img.cdn.dragon2000.net/C3656/U2266/IMG_1200-large.jpg",
      "https://smgmedia.blob.core.windows.net/images/129757/1920/car.jpg",
      "https://bluesky.cdn.imgeng.in/cogstock-images/motors-aaa.jpg",
      "https://api.dealerwebsites.co.uk/abc123.jpg",
    ]);
  });

  it("collapses WordPress -WxH-N and -scaled siblings, and UUID jpg/webp twins", () => {
    expect(
      uniqueImageUrls([
        "https://www.philshawvehicles.im/wp-content/uploads/2026/07/P1190889-640x450-1.jpg",
        "https://www.philshawvehicles.im/wp-content/uploads/2026/07/P1190889.jpg",
        "https://motorx.im/wp-content/uploads/2026/08/IMG_8140-150x150.jpeg",
        "https://motorx.im/wp-content/uploads/2026/08/IMG_8140-scaled.jpeg",
        "https://vanmossel.images.ilsa.cloud/11f80c9b-d335-4e5e-9ec4-f346becc6ad7.webp",
        "https://vanmossel.images.ilsa.cloud/11f80c9b-d335-4e5e-9ec4-f346becc6ad7.jpg",
      ]),
    ).toEqual([
      "https://www.philshawvehicles.im/wp-content/uploads/2026/07/P1190889.jpg",
      "https://motorx.im/wp-content/uploads/2026/08/IMG_8140-scaled.jpeg",
      "https://vanmossel.images.ilsa.cloud/11f80c9b-d335-4e5e-9ec4-f346becc6ad7.webp",
    ]);
  });
});

describe("IMG-SHARED-001 shared helper wiring", () => {
  it("uses the same uniqueImageUrls implementation across Ocean, dealer-stock, HTML, and preview", () => {
    expect(oceanUniqueImageUrls).toBe(uniqueImageUrls);
    const html = `
      <img src="${ndUrl("ndstock/a.jpg", 400)}" />
      <img src="${ndUrl("ndstock/a.jpg", 800)}" />
      <img src="//s3-eu-west-1.amazonaws.com/nd-stock/photo_1.jpg" />
    `;
    expect(extractDealerHtml(html)).toEqual(extractOceanHtml(html));
    expect(extractOceanHtml(html)).toHaveLength(2);
    expect(
      previewImageSources(
        [],
        [
          "https://sncc.im/wp-content/uploads/2026/08/IMG_1038-876x535.jpeg",
          "https://sncc.im/wp-content/uploads/2026/08/IMG_1038.jpeg",
        ],
      ).map((source) => source.url),
    ).toEqual(["https://sncc.im/wp-content/uploads/2026/08/IMG_1038.jpeg"]);
  });
});
