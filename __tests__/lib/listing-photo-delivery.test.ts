import { describe, expect, it } from "vitest";
import { getImgProps } from "next/dist/shared/lib/get-img-props";
import { LISTING_PHOTO_WIDTHS } from "@/lib/images/constraints";
import { buildListingPhotoUrl } from "@/lib/images/cloudinary-url";
import {
  LISTING_CARD_SIZES,
  LISTING_GALLERY_SIZES,
  LISTING_GALLERY_THUMB_SIZES,
  LISTING_LIGHTBOX_SIZES,
  LISTING_PHOTO_DELIVERY_WIDTHS,
} from "@/lib/images/delivery-widths";
import {
  buildProviderListingPhotoAttributes,
  deliveryWidthsForPhoto,
  providerListingPhotoConfig,
} from "@/lib/images/listing-photo-attributes";
import { imageKitTransformForMode } from "@/lib/media/imagekit-transforms";
import { listingPhotoDeliveryQuerySchema } from "@/lib/media/listing-photo-query";
import type { ListingPhotoSource } from "@/lib/images/photo";

const photo: ListingPhotoSource = {
  id: "img-1",
  url: "https://res.cloudinary.com/demo/image/private/v12/iommarket/listings/staging/user/landscape.jpg",
  publicId: "iommarket/listings/staging/user/landscape",
  provider: "CLOUDINARY",
  version: "12",
  width: 3000,
  height: 2000,
};

function candidateWidths(srcSet: string | undefined) {
  return (srcSet ?? "").split(",").filter(Boolean).map((part) => {
    const [url, descriptor] = part.trim().split(/\s+/);
    const requested = Number(new URL(url ?? "", "http://localhost").searchParams.get("w"));
    const advertised = Number((descriptor ?? "").replace("w", ""));
    return { url: url ?? "", requested, advertised };
  });
}

describe("listing photo delivery widths", () => {
  it("rejects aspect-ratio widths and the default 3840 candidate", () => {
    for (const width of [1, 4, 16, 3840, 2000]) {
      expect(listingPhotoDeliveryQuerySchema.safeParse({
        imageId: "img-1",
        mode: "fit",
        frame: "gallery",
        w: String(width),
      }).success).toBe(false);
    }
    for (const width of LISTING_PHOTO_DELIVERY_WIDTHS) {
      expect(listingPhotoDeliveryQuerySchema.safeParse({
        imageId: "img-1",
        source: "revision",
        mode: "fill",
        frame: "card",
        w: String(width),
      }).success).toBe(true);
    }
  });

  it("keeps ImageKit transforms on the advertised width", () => {
    for (const width of LISTING_PHOTO_DELIVERY_WIDTHS) {
      const transform = imageKitTransformForMode({ mode: "fit", frame: "gallery", width });
      const height = Math.max(1, Math.round((width * 10) / 16));
      expect(transform).toBe(`w-${width},h-${height},c-at_max`);
    }
    expect(imageKitTransformForMode({ mode: "blur", frame: "gallery", width: 1600 })).toBe(
      "w-320,h-200,c-maintain_ratio,bl-10",
    );
  });

  it("matches Next.js srcset generation and does not clamp those candidates", () => {
    const widths = deliveryWidthsForPhoto("fit", photo.width);
    const config = providerListingPhotoConfig(widths);
    const loader = ({ width }: { src: string; width: number }) => `/api/media/listing-photo?w=${width}`;
    const { props } = getImgProps(
      {
        src: "/api/media/listing-photo",
        alt: "Gallery",
        fill: true,
        sizes: LISTING_GALLERY_SIZES,
        loader,
      },
      { defaultLoader: loader, imgConf: config },
    );
    const generated = candidateWidths(props.srcSet);
    expect(generated.map((candidate) => candidate.advertised)).not.toContain(3840);
    expect(generated.map((candidate) => candidate.advertised)).not.toContain(16);
    expect(generated.every((candidate) => candidate.requested === candidate.advertised)).toBe(true);
    expect(generated.every((candidate) => (
      listingPhotoDeliveryQuerySchema.safeParse({
        imageId: "img-1",
        mode: "fit",
        frame: "gallery",
        w: String(candidate.requested),
      }).success
    ))).toBe(true);

    const built = buildProviderListingPhotoAttributes({
      photo,
      frame: "gallery",
      mode: "fit",
      sizes: LISTING_GALLERY_SIZES,
      alt: "Gallery",
    });
    expect(candidateWidths(built.props.srcSet).map((candidate) => candidate.advertised)).toEqual(
      generated.map((candidate) => candidate.advertised),
    );
    expect(Object.keys(built.props).at(-1)).toBe("src");
  });

  it("caps fill candidates at the source width and leaves Cloudinary's ladder unchanged", () => {
    expect(deliveryWidthsForPhoto("fill", 1000).every((width) => width <= 1000)).toBe(true);
    expect(deliveryWidthsForPhoto("fill", 1000)).not.toContain(1200);
    expect(deliveryWidthsForPhoto("fit", 1000)).toContain(2400);
    expect(LISTING_PHOTO_WIDTHS.at(-1)).toBe(1600);
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const url = buildListingPhotoUrl(photo, { width: 3840, mode: "fill", frame: "gallery" });
    expect(url).toContain("w_1600");
    expect(url).not.toContain("w_2400");
    expect(url).not.toContain("w_3840");
  });

  it("selects small thumb and card candidates from the same ladder", () => {
    const thumb = buildProviderListingPhotoAttributes({
      photo,
      frame: "thumb",
      mode: "fill",
      sizes: LISTING_GALLERY_THUMB_SIZES,
      alt: "Thumb",
    });
    const card = buildProviderListingPhotoAttributes({
      photo: { ...photo, width: 1600, height: 1200 },
      frame: "card",
      mode: "fill",
      sizes: LISTING_CARD_SIZES,
      alt: "Card",
    });
    const lightbox = buildProviderListingPhotoAttributes({
      photo,
      frame: "gallery",
      mode: "fit",
      sizes: LISTING_LIGHTBOX_SIZES,
      alt: "Lightbox",
    });
    expect(candidateWidths(thumb.props.srcSet).some((candidate) => candidate.advertised <= 480)).toBe(true);
    expect(candidateWidths(card.props.srcSet).every((candidate) => candidate.advertised <= 1600)).toBe(true);
    expect(candidateWidths(lightbox.props.srcSet).at(-1)?.advertised).toBe(2400);
    expect(candidateWidths(lightbox.props.srcSet).some((candidate) => candidate.url.includes("/_next/image"))).toBe(false);
  });
});
