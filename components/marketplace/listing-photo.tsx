"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
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
  const [failed, setFailed] = useState(false);
  const [retrySrc, setRetrySrc] = useState<string>();
  const [recovered, setRecovered] = useState(false);
  if (failed && hidden) return null;

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
  const showThumbnail = Boolean(thumbnailSrc && (failed || (retrySrc && !recovered)));
  // Picture prevents React SSR from hoisting a separate image preload.
  return (
    <>
      {showThumbnail && (
        <picture>
          <img src={thumbnailSrc} alt={photoAlt} className={className}
            style={{ ...imageProps.style, objectFit: "contain" }} onError={onThumbnailUnavailable}
            data-photo-fallback="thumbnail" />
        </picture>
      )}
      {!failed && (
        <picture>
          <img
            {...imageProps}
            alt={showThumbnail ? "" : photoAlt}
            aria-hidden={showThumbnail ? true : imageProps["aria-hidden"]}
            style={showThumbnail ? { ...imageProps.style, opacity: 0 } : imageProps.style}
            src={retrySrc ?? imageProps.src}
            srcSet={retrySrc ? undefined : imageProps.srcSet}
            onLoad={({ currentTarget }) => {
              if (retrySrc) setRecovered(true);
              if (!hidden && currentTarget.naturalWidth) onPhotoLoad?.(currentTarget.currentSrc || currentTarget.src);
            }}
            onError={({ currentTarget }) => {
              if (!hidden && !retrySrc) {
                const url = new URL(currentTarget.currentSrc || imageProps.src, window.location.origin);
                url.searchParams.set("retry", "1");
                setRetrySrc(url.pathname + url.search);
                setRecovered(false);
                return;
              }
              setFailed(true);
              if (!hidden) onPhotoUnavailable?.();
            }}
          />
        </picture>
      )}
      {failed && !showThumbnail && !onPhotoUnavailable && <PhotoUnavailable />}
    </>
  );
}

function PhotoUnavailable() {
  return <span className="absolute inset-0 grid place-content-center p-3 text-center text-sm text-text-secondary">Photo temporarily unavailable</span>;
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
  const [failed, setFailed] = useState(false);
  if (failed || imageSrc === "/media-unresolved.svg") {
    if (hidden) return null;
    return thumbnailSrc ? (
      <Image src={thumbnailSrc} alt={alt} fill unoptimized className="object-contain" onError={onThumbnailUnavailable} />
    ) : !onPhotoUnavailable && <PhotoUnavailable />;
  }
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
      onLoad={({ currentTarget }) => {
        if (!hidden && currentTarget.naturalWidth) onPhotoLoad?.(currentTarget.currentSrc || currentTarget.src);
      }}
      onError={() => {
        setFailed(true);
        if (!hidden) onPhotoUnavailable?.();
      }}
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
  thumbnailSrc,
  onPhotoLoad,
  onPhotoUnavailable,
  onThumbnailUnavailable,
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
