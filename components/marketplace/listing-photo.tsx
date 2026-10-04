"use client";

import Image from "next/image";
import { cn } from "@/lib/cn";
import {
  LISTING_PHOTO_FRAMES,
  type ListingPhotoFrame,
} from "@/lib/images/constraints";
import { buildListingPhotoUrl } from "@/lib/images/cloudinary-url";
import { getListingPhotoFitMode } from "@/lib/images/fit-policy";
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

function usesProviderDelivery(photo: ListingPhotoSource) {
  const mode = process.env.NEXT_PUBLIC_MEDIA_PROVIDER;
  return Boolean(photo.id) && (
    mode === "imagekit" ||
    mode === "imagekit-sample" ||
    photo.publicId.startsWith("imagekit-dev/") ||
    photo.url.startsWith("imagekit-private:")
  );
}

function directProviderSrc(
  photo: ListingPhotoSource,
  frame: ListingPhotoFrame,
  mode: "fill" | "fit" | "blur",
) {
  const params = new URLSearchParams({
    imageId: photo.id ?? "",
    source: photo.deliverySource ?? "listing",
    mode,
    frame,
    w: String(LISTING_PHOTO_FRAMES[frame].width),
  });
  return `/api/media/listing-photo?${params.toString()}`;
}

function listingPhotoLoader(
  photo: ListingPhotoSource,
  frame: ListingPhotoFrame,
  mode: "fill" | "fit" | "blur",
) {
  if (usesProviderDelivery(photo)) {
    return ({ width }: { width: number; quality?: number }) => {
      const params = new URLSearchParams({
        imageId: photo.id ?? "",
        source: photo.deliverySource ?? "listing",
        mode,
        frame,
        w: String(width),
      });
      return `/api/media/listing-photo?${params.toString()}`;
    };
  }
  return ({ width, quality }: { width: number; quality?: number }) =>
    buildListingPhotoUrl(photo, { width, quality, mode, frame });
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
  const useCloudinary = photo.provider === "CLOUDINARY" || usesProviderDelivery(photo);
  const imageSrc = photo.url.startsWith("imagekit-private:") ? "/media-unresolved.svg" : photo.url;
  const frameClassName = fillContainer ? "h-full w-full" : frameSize.aspectClass;
  if (photo.format === "mp4" && usesProviderDelivery(photo)) {
    const params = new URLSearchParams({
      imageId: photo.id ?? "",
      source: photo.deliverySource ?? "listing",
      mode: "fit",
      frame,
      w: "960",
    });
    return (
      <div className={cn("relative overflow-hidden bg-black", frameClassName, className)}>
        <video
          className={cn("h-full w-full object-contain", imageClassName)}
          controls
          playsInline
          preload="metadata"
          src={`/api/media/listing-photo?${params.toString()}`}
        />
      </div>
    );
  }

  if (variant === "contain") {
    return (
      <div className={cn("relative overflow-hidden bg-black", frameClassName, className)}>
        <Image
          src={usesProviderDelivery(photo) ? directProviderSrc(photo, frame, "fit") : imageSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn("object-contain", imageClassName)}
          style={{ objectPosition: "center" }}
          loader={useCloudinary && !usesProviderDelivery(photo) ? listingPhotoLoader(photo, frame, "fit") : undefined}
          unoptimized={unoptimized || usesProviderDelivery(photo) || !useCloudinary}
        />
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-graphite-800", frameClassName, className)}>
      {fitMode === "pad" ? (
        <>
          <Image
            src={usesProviderDelivery(photo) ? directProviderSrc(photo, frame, "blur") : imageSrc}
            alt=""
            fill
            sizes="320px"
            aria-hidden="true"
            className="scale-110 object-cover blur-xl"
            style={{ objectPosition: focalObjectPosition }}
            loader={useCloudinary && !usesProviderDelivery(photo) ? listingPhotoLoader(photo, frame, "blur") : undefined}
            unoptimized={unoptimized || usesProviderDelivery(photo) || !useCloudinary}
          />
          <Image
            src={usesProviderDelivery(photo) ? directProviderSrc(photo, frame, "fit") : imageSrc}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className={cn("object-contain", imageClassName)}
            style={{ objectPosition: "center" }}
            loader={useCloudinary && !usesProviderDelivery(photo) ? listingPhotoLoader(photo, frame, "fit") : undefined}
            unoptimized={unoptimized || usesProviderDelivery(photo) || !useCloudinary}
          />
        </>
      ) : (
        <Image
          src={usesProviderDelivery(photo) ? directProviderSrc(photo, frame, "fill") : imageSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn("object-cover", imageClassName)}
          style={{ objectPosition: focalObjectPosition }}
          loader={useCloudinary && !usesProviderDelivery(photo) ? listingPhotoLoader(photo, frame, "fill") : undefined}
          unoptimized={unoptimized || usesProviderDelivery(photo) || !useCloudinary}
        />
      )}
    </div>
  );
}
