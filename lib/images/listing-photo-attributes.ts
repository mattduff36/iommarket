import type { CSSProperties } from "react";
import { getImgProps } from "next/dist/shared/lib/get-img-props";
import { imageConfigDefault, type ImageConfigComplete } from "next/dist/shared/lib/image-config";
import type { ListingPhotoFrame } from "@/lib/images/constraints";
import {
  LISTING_PHOTO_BLUR_WIDTH,
  LISTING_PHOTO_DELIVERY_WIDTHS,
  LISTING_PHOTO_UNOPTIMIZED_WIDTH,
  listingPhotoDeliveryUrl,
  type ListingPhotoDeliveryWidth,
} from "@/lib/images/delivery-widths";
import type { ListingPhotoSource } from "@/lib/images/photo";

type DeliveryMode = "fill" | "fit" | "blur";

export type DeliveredListingPhotoProps = {
  alt: string;
  src: string;
  srcSet?: string;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
  decoding: "async";
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  "aria-hidden"?: true;
};

const ABSOLUTE_FILL_STYLE: CSSProperties = {
  position: "absolute",
  height: "100%",
  width: "100%",
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};

/**
 * Widths ImageKit may crop up to. Fit mode uses c-at_max, which does not enlarge.
 * Fill mode can enlarge, so its candidates stop at the source width.
 */
export function deliveryWidthsForPhoto(
  mode: DeliveryMode,
  sourceWidth?: number | null,
): readonly ListingPhotoDeliveryWidth[] {
  if (mode === "blur") return [LISTING_PHOTO_BLUR_WIDTH];
  if (mode !== "fill" || sourceWidth == null || sourceWidth <= 0) {
    return LISTING_PHOTO_DELIVERY_WIDTHS;
  }
  const capped = LISTING_PHOTO_DELIVERY_WIDTHS.filter((width) => width <= sourceWidth);
  return capped.length > 0 ? capped : [LISTING_PHOTO_DELIVERY_WIDTHS[0]];
}

export function providerListingPhotoConfig(
  widths: readonly number[],
): ImageConfigComplete {
  const imageSizes = widths.filter((width) => width < 640);
  const deviceSizes = widths.filter((width) => width >= 640);
  const safeDeviceSizes = deviceSizes.length > 0
    ? deviceSizes
    : [widths[widths.length - 1] ?? LISTING_PHOTO_BLUR_WIDTH];
  const safeImageSizes = deviceSizes.length > 0
    ? imageSizes
    : widths.filter((width) => width !== safeDeviceSizes[0]);
  return {
    ...imageConfigDefault,
    deviceSizes: [...safeDeviceSizes],
    imageSizes: [...safeImageSizes],
    qualities: [...(imageConfigDefault.qualities ?? [75])],
  };
}

const PROP_ORDER = [
  "alt",
  "srcSet",
  "sizes",
  "className",
  "style",
  "decoding",
  "loading",
  "fetchPriority",
  "aria-hidden",
  "src",
] as const;

function deliveredProps(props: DeliveredListingPhotoProps): DeliveredListingPhotoProps {
  const entries = PROP_ORDER.flatMap((key) => {
    const value = props[key];
    return value === undefined ? [] : [[key, value] as const];
  });
  return Object.fromEntries(entries) as DeliveredListingPhotoProps;
}

export function buildProviderListingPhotoAttributes(input: {
  photo: ListingPhotoSource;
  frame: ListingPhotoFrame;
  mode: DeliveryMode;
  sizes: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
  unoptimized?: boolean;
  "aria-hidden"?: boolean;
}): { preload: boolean; props: DeliveredListingPhotoProps } {
  const singleWidth = input.mode === "blur"
    ? LISTING_PHOTO_BLUR_WIDTH
    : input.unoptimized
      ? LISTING_PHOTO_UNOPTIMIZED_WIDTH
      : null;

  if (singleWidth !== null) {
    const decorative = input.mode === "blur";
    const eager = Boolean(input.priority) && !decorative;
    return {
      preload: eager,
      props: deliveredProps({
        alt: input.alt,
        className: input.className,
        decoding: "async",
        loading: eager ? "eager" : "lazy",
        fetchPriority: decorative ? "low" : eager ? "high" : undefined,
        style: { ...ABSOLUTE_FILL_STYLE, ...input.style },
        "aria-hidden": input["aria-hidden"] ? true : undefined,
        src: listingPhotoDeliveryUrl(input.photo, input.frame, input.mode, singleWidth),
      }),
    };
  }

  const widths = deliveryWidthsForPhoto(input.mode, input.photo.width);
  const loader = ({ width }: { src: string; width: number; quality?: number }) =>
    listingPhotoDeliveryUrl(input.photo, input.frame, input.mode, width);
  const { props, meta } = getImgProps(
    {
      src: "/api/media/listing-photo",
      alt: input.alt,
      fill: true,
      sizes: input.sizes,
      loader,
      className: input.className,
      style: input.style,
      priority: input.priority,
      fetchPriority: input.priority ? "high" : undefined,
      ...(input["aria-hidden"] ? { "aria-hidden": true as const } : {}),
    },
    {
      defaultLoader: loader,
      imgConf: providerListingPhotoConfig(widths),
    },
  );
  const fetchPriority = props.fetchPriority === "high" || props.fetchPriority === "low" || props.fetchPriority === "auto"
    ? props.fetchPriority
    : undefined;
  const loading = props.loading === "eager" || props.loading === "lazy" ? props.loading : undefined;

  return {
    preload: meta.preload,
    props: deliveredProps({
      alt: props.alt,
      srcSet: props.srcSet,
      sizes: props.sizes,
      className: props.className,
      style: props.style,
      decoding: "async",
      loading,
      fetchPriority,
      "aria-hidden": props["aria-hidden"] ? true : undefined,
      src: props.src,
    }),
  };
}
