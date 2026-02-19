"use client";

import { useState, useCallback } from "react";
import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ImagePlus, X } from "lucide-react";
import { IMAGE_CONSTRAINTS } from "@/lib/upload/cloudinary";

export interface UploadedImage {
  url: string;
  publicId: string;
  order: number;
}

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number;
}

export function ImageUpload({
  images,
  onImagesChange,
  maxImages = 10,
}: ImageUploadProps) {
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(
    (result: CloudinaryUploadWidgetResults) => {
      if (result.event !== "success" || !result.info) return;
      const info = result.info as {
        secure_url: string;
        public_id: string;
      };

      if (images.length >= maxImages) {
        setError(`Maximum ${maxImages} images allowed`);
        return;
      }

      setError(null);
      onImagesChange([
        ...images,
        {
          url: info.secure_url,
          publicId: info.public_id,
          order: images.length,
        },
      ]);
    },
    [images, maxImages, onImagesChange],
  );

  function handleRemove(index: number) {
    const updated = images
      .filter((_, i) => i !== index)
      .map((img, i) => ({ ...img, order: i }));
    onImagesChange(updated);
    setError(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">
          Photos ({images.length}/{maxImages})
        </label>
      </div>

      {/* Uploaded images preview */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {images.map((img, i) => (
            <div
              key={img.publicId}
              className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-subtle"
            >
              <Image
                src={img.url}
                alt={`Upload ${i + 1}`}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 33vw, 160px"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(i)}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label={`Remove image ${i + 1}`}
              >
                <X className="h-3 w-3" />
              </Button>
              {i === 0 && (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Main
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {images.length < maxImages && (
        <CldUploadWidget
          uploadPreset="iommarket_unsigned"
          options={{
            folder: IMAGE_CONSTRAINTS.folder,
            maxFileSize: IMAGE_CONSTRAINTS.maxFileSizeBytes,
            clientAllowedFormats: [...IMAGE_CONSTRAINTS.allowedFormats],
            maxImageWidth: IMAGE_CONSTRAINTS.maxWidth,
            maxImageHeight: IMAGE_CONSTRAINTS.maxHeight,
            multiple: true,
            maxFiles: maxImages - images.length,
            sources: ["local", "camera"],
            cropping: false,
          }}
          onSuccess={handleUpload}
        >
          {({ open }) => (
            <Button
              type="button"
              variant="secondary"
              onClick={() => open()}
              className="w-full"
            >
              <ImagePlus className="h-4 w-4" />
              Add Photos
            </Button>
          )}
        </CldUploadWidget>
      )}

      {error && <p className="text-xs text-text-error">{error}</p>}

      <p className="text-xs text-text-tertiary">
        Upload up to {maxImages} photos. JPG, PNG, or WebP, max 10MB each.
        First image will be the main photo.
      </p>
    </div>
  );
}
