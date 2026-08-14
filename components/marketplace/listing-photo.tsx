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

function listingPhotoLoader(
  photo: ListingPhotoSource,
  frame: ListingPhotoFrame,
  mode: "fill" | "fit" | "blur",
) {
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
  const objectPosition = hasValidFocalPoint(photo)
    ? `${photo.focalX! * 100}% ${photo.focalY! * 100}%`
    : "center";
  const useCloudinary = photo.provider === "CLOUDINARY";
  const frameClassName = fillContainer ? "h-full w-full" : frameSize.aspectClass;

  if (variant === "contain") {
    return (
      <div className={cn("relative overflow-hidden bg-black", frameClassName, className)}>
        <Image
          src={photo.url}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn("object-contain", imageClassName)}
          style={{ objectPosition }}
          loader={useCloudinary ? listingPhotoLoader(photo, frame, "fit") : undefined}
          unoptimized={unoptimized || !useCloudinary}
        />
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-graphite-800", frameClassName, className)}>
      {fitMode === "pad" ? (
        <>
          <Image
            src={photo.url}
            alt=""
            fill
            sizes="320px"
            aria-hidden="true"
            className="scale-110 object-cover blur-xl"
            style={{ objectPosition }}
            loader={useCloudinary ? listingPhotoLoader(photo, frame, "blur") : undefined}
            unoptimized={unoptimized || !useCloudinary}
          />
          <Image
            src={photo.url}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className={cn("object-contain", imageClassName)}
            style={{ objectPosition }}
            loader={useCloudinary ? listingPhotoLoader(photo, frame, "fit") : undefined}
            unoptimized={unoptimized || !useCloudinary}
          />
        </>
      ) : (
        <Image
          src={photo.url}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn("object-cover", imageClassName)}
          style={{ objectPosition }}
          loader={useCloudinary ? listingPhotoLoader(photo, frame, "fill") : undefined}
          unoptimized={unoptimized || !useCloudinary}
        />
      )}
    </div>
  );
}
