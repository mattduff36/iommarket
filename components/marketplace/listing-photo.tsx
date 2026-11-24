"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePhotoRetry } from "./use-photo-retry";
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

interface PhotoRecovery {
  thumbnailSrc?: string;
  onPhotoLoad?: (src: string) => void;
  onPhotoUnavailable?: () => void;
  onThumbnailUnavailable?: () => void;
  allowManualRetry?: boolean;
}

interface ListingPhotoProps extends PhotoRecovery {
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
  return Boolean(photo.id || photo.uploadIntentId) && (
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
  thumbnailSrc,
  onPhotoLoad,
  onPhotoUnavailable,
  onThumbnailUnavailable,
  allowManualRetry,
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
} & PhotoRecovery) {
  const attempt = usePhotoRetry({ decorative: hidden, onPhotoLoad, onPhotoUnavailable });

  const { alt: photoAlt, ...imageProps } = buildProviderListingPhotoAttributes({
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
  const showThumbnail = Boolean(thumbnailSrc && attempt.showFallback);
  let retrySrc: string | undefined;
  if (attempt.failedSource) {
    const url = new URL(attempt.failedSource);
    url.searchParams.set("retry", String(attempt.retries));
    retrySrc = url.pathname + url.search;
  }
  // Picture prevents React SSR from hoisting a separate image preload.
  return (
    <>
      {attempt.showLoading && !showThumbnail && <PhotoLoading frame={frame} announce={Boolean(photoAlt)} />}
      {showThumbnail && (
        <picture>
          <img src={thumbnailSrc} alt={photoAlt} className={className}
            style={{ ...imageProps.style, objectFit: "contain" }} onError={onThumbnailUnavailable}
            data-photo-fallback="thumbnail" />
        </picture>
      )}
      {attempt.showImage && (
        <picture>
          <img
            {...imageProps}
            alt={showThumbnail ? "" : photoAlt}
            aria-hidden={showThumbnail ? true : imageProps["aria-hidden"]}
            style={showThumbnail ? { ...imageProps.style, opacity: 0 } : imageProps.style}
            src={retrySrc ?? imageProps.src}
            srcSet={retrySrc ? undefined : imageProps.srcSet}
            onLoad={attempt.onLoad}
            onError={attempt.onError}
          />
        </picture>
      )}
      {attempt.status === "unavailable" && !hidden && !showThumbnail && !onPhotoUnavailable
        && <PhotoUnavailable onRetry={allowManualRetry ? attempt.retry : undefined} />}
    </>
  );
}

function PhotoLoading({ frame, announce }: { frame: ListingPhotoFrame; announce: boolean }) {
  const label = frame === "gallery" && announce;
  return (
    <Skeleton data-photo-loading="" role={label ? "status" : undefined} aria-hidden={label ? undefined : true}
      className="pointer-events-none absolute inset-0 grid place-content-center rounded-none text-sm text-text-secondary motion-reduce:animate-none">
      {label && "Loading photo…"}
    </Skeleton>
  );
}

function PhotoUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 p-3 text-center text-sm text-text-secondary">
      <span>Photo temporarily unavailable</span>
      {onRetry && (
        <Button type="button" size="sm" className="pointer-events-auto relative z-20" onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
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
  thumbnailSrc,
  onPhotoLoad,
  onPhotoUnavailable,
  onThumbnailUnavailable,
  allowManualRetry,
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
} & PhotoRecovery) {
  const useCloudinary = photo.provider === "CLOUDINARY";
  const attempt = usePhotoRetry({ decorative: hidden, onPhotoLoad, onPhotoUnavailable });
  const unresolved = imageSrc === "/media-unresolved.svg";
  const showThumbnail = Boolean(thumbnailSrc && (unresolved || attempt.showFallback));
  return (
    <>
      {!unresolved && attempt.showLoading && !showThumbnail && <PhotoLoading frame={frame} announce={Boolean(alt)} />}
      {showThumbnail && thumbnailSrc && (
        <Image src={thumbnailSrc} alt={alt} fill unoptimized className="object-contain" onError={onThumbnailUnavailable}
          data-photo-fallback="thumbnail" />
      )}
      {!unresolved && attempt.showImage && (
        <Image
          src={imageSrc}
          alt={showThumbnail ? "" : alt}
          fill
          sizes={sizes}
          priority={priority && attempt.retries === 0}
          className={className}
          style={showThumbnail ? { ...style, opacity: 0 } : style}
          aria-hidden={hidden || showThumbnail || undefined}
          loader={useCloudinary ? listingPhotoLoader(photo, frame, mode) : undefined}
          unoptimized={unoptimized || !useCloudinary}
          onLoad={attempt.onLoad}
          onError={attempt.onError}
        />
      )}
      {(unresolved || attempt.status === "unavailable") && !hidden && !showThumbnail && !onPhotoUnavailable
        && <PhotoUnavailable onRetry={allowManualRetry && !unresolved ? attempt.retry : undefined} />}
    </>
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
  thumbnailSrc,
  onPhotoLoad,
  onPhotoUnavailable,
  onThumbnailUnavailable,
  allowManualRetry,
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
          key={listingPhotoDeliveryUrl(photo, frame, mode, 960)}
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
          thumbnailSrc={hidden ? undefined : thumbnailSrc}
          onPhotoLoad={onPhotoLoad}
          onPhotoUnavailable={onPhotoUnavailable}
          onThumbnailUnavailable={onThumbnailUnavailable}
          allowManualRetry={allowManualRetry}
        />
      );
    }
    return (
      <CloudinaryListingPhoto
        key={frame + ":" + mode + ":" + imageSrc}
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
        thumbnailSrc={hidden ? undefined : thumbnailSrc}
        onPhotoLoad={onPhotoLoad}
        onPhotoUnavailable={onPhotoUnavailable}
        onThumbnailUnavailable={onThumbnailUnavailable}
        allowManualRetry={allowManualRetry}
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
          {frame !== "thumb" && renderPhoto(
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
