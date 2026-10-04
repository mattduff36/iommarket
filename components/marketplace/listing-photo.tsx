"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { preload } from "react-dom";
import { cn } from "@/lib/cn";
import {
  LISTING_PHOTO_FRAMES,
  type ListingPhotoFrame,
} from "@/lib/images/constraints";
import { buildListingPhotoUrl } from "@/lib/images/cloudinary-url";
import { listingPhotoDeliveryUrl } from "@/lib/images/delivery-widths";
import { getListingPhotoFitMode } from "@/lib/images/fit-policy";
import { buildProviderListingPhotoAttributes } from "@/lib/images/listing-photo-attributes";
import { hasValidFocalPoint, type ListingPhotoSource } from "@/lib/images/photo";

interface ListingPhotoProps {
  photo: ListingPhotoSource;
  frame: ListingPhotoFrame;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
  unoptimized?: boolean;
  variant?: "adaptive" | "contain";
  fillContainer?: boolean;
}

type DeliveryMode = "fill" | "fit" | "blur";

function usesProviderDelivery(photo: ListingPhotoSource) {
  const mode = process.env.NEXT_PUBLIC_MEDIA_PROVIDER;
  return Boolean(photo.id) && (
    mode === "imagekit" ||
    mode === "imagekit-sample" ||
    photo.publicId.startsWith("imagekit-dev/") ||
    photo.url.startsWith("imagekit-private:")
  );
}

function listingPhotoLoader(
  photo: ListingPhotoSource,
  frame: ListingPhotoFrame,
  mode: DeliveryMode,
) {
  return ({ width, quality }: { width: number; quality?: number }) =>
    buildListingPhotoUrl(photo, { width, quality, mode, frame });
}

function ProviderListingPhoto({
  photo,
  frame,
  mode,
  alt,
  sizes,
  priority = false,
  className,
  style,
  unoptimized = false,
  hidden = false,
}: {
  photo: ListingPhotoSource;
  frame: ListingPhotoFrame;
  mode: DeliveryMode;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
  unoptimized?: boolean;
  hidden?: boolean;
}) {
  const built = buildProviderListingPhotoAttributes({
    photo,
    frame,
    mode,
    alt,
    sizes,
    priority,
    className,
    style,
    unoptimized,
    "aria-hidden": hidden || undefined,
  });
  if (built.preload) {
    preload(built.props.src, {
      as: "image",
      imageSrcSet: built.props.srcSet,
      imageSizes: built.props.sizes,
      fetchPriority: "high",
    });
  }
  const { alt: photoAlt, ...imageProps } = built.props;
  // Same-origin signing URLs must not go through /_next/image, which cannot
  // forward the viewer's session. Widths come from Next's getImgProps.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...imageProps} alt={photoAlt} />;
}

function CloudinaryListingPhoto({
  photo,
  frame,
  mode,
  alt,
  sizes,
  priority = false,
  className,
  style,
  unoptimized = false,
  hidden = false,
  imageSrc,
}: {
  photo: ListingPhotoSource;
  frame: ListingPhotoFrame;
  mode: DeliveryMode;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
  unoptimized?: boolean;
  hidden?: boolean;
  imageSrc: string;
}) {
  const useCloudinary = photo.provider === "CLOUDINARY";
  return (
    <Image
      src={imageSrc}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      style={style}
      aria-hidden={hidden || undefined}
      loader={useCloudinary ? listingPhotoLoader(photo, frame, mode) : undefined}
      unoptimized={unoptimized || !useCloudinary}
    />
  );
}

export function ListingPhoto({
  photo,
  frame,
  alt,
  sizes,
  priority = false,
  className,
  imageClassName,
  unoptimized = false,
  variant = "adaptive",
  fillContainer = false,
}: ListingPhotoProps) {
  const frameSize = LISTING_PHOTO_FRAMES[frame];
  const fitMode =
    variant === "contain"
      ? "pad"
      : getListingPhotoFitMode({
          sourceWidth: photo.width,
          sourceHeight: photo.height,
          frameWidth: frameSize.width,
          frameHeight: frameSize.height,
        });
  const focalObjectPosition = hasValidFocalPoint(photo)
    ? `${photo.focalX! * 100}% ${photo.focalY! * 100}%`
    : "center";
  const providerDelivery = usesProviderDelivery(photo);
  const imageSrc = photo.url.startsWith("imagekit-private:") ? "/media-unresolved.svg" : photo.url;
  const frameClassName = fillContainer ? "h-full w-full" : frameSize.aspectClass;

  function renderPhoto(
    mode: DeliveryMode,
    photoSizes: string,
    photoAlt: string,
    photoClassName: string | undefined,
    style: CSSProperties | undefined,
    photoPriority = false,
    hidden = false,
  ) {
    if (providerDelivery) {
      return (
        <ProviderListingPhoto
          photo={photo}
          frame={frame}
          mode={mode}
          alt={photoAlt}
          sizes={photoSizes}
          priority={photoPriority}
          className={photoClassName}
          style={style}
          unoptimized={unoptimized}
          hidden={hidden}
        />
      );
    }
    return (
      <CloudinaryListingPhoto
        photo={photo}
        frame={frame}
        mode={mode}
        alt={photoAlt}
        sizes={photoSizes}
        priority={photoPriority}
        className={photoClassName}
        style={style}
        unoptimized={unoptimized}
        hidden={hidden}
        imageSrc={imageSrc}
      />
    );
  }

  if (photo.format === "mp4" && providerDelivery) {
    return (
      <div className={cn("relative overflow-hidden bg-black", frameClassName, className)}>
        <video
          className={cn("h-full w-full object-contain", imageClassName)}
          controls
          playsInline
          preload="metadata"
          src={listingPhotoDeliveryUrl(photo, frame, "fit", 960)}
        />
      </div>
    );
  }

  if (variant === "contain") {
    return (
      <div className={cn("relative overflow-hidden bg-black", frameClassName, className)}>
        {renderPhoto("fit", sizes, alt, cn("object-contain", imageClassName), { objectPosition: "center" }, priority)}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-graphite-800", frameClassName, className)}>
      {fitMode === "pad" ? (
        <>
          {renderPhoto(
            "blur",
            "320px",
            "",
            "scale-110 object-cover blur-xl",
            { objectPosition: focalObjectPosition },
            false,
            true,
          )}
          {renderPhoto("fit", sizes, alt, cn("object-contain", imageClassName), { objectPosition: "center" }, priority)}
        </>
      ) : (
        renderPhoto(
          "fill",
          sizes,
          alt,
          cn("object-cover", imageClassName),
          { objectPosition: focalObjectPosition },
          priority,
        )
      )}
    </div>
  );
}
