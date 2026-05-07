"use client";

import * as React from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ImagePlus, RotateCcw, UploadCloud, X } from "lucide-react";
import { IMAGE_CONSTRAINTS, LISTING_IMAGE_TARGET } from "@/lib/upload/cloudinary";
import { cn } from "@/lib/cn";

export interface UploadedImage {
  url: string;
  publicId: string;
  order: number;
}

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: React.Dispatch<React.SetStateAction<UploadedImage[]>>;
  uploadPreset?: string | null;
  maxImages?: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface CropPercent {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropJob {
  id: string;
  file: File;
  previewUrl: string;
  dimensions: ImageDimensions;
  initialCrop: CropPercent;
}

interface CloudinaryUploadResponse {
  secure_url?: string;
  public_id?: string;
  error?: {
    message?: string;
  };
}

export function ImageUpload({
  images,
  onImagesChange,
  uploadPreset = null,
  maxImages = 10,
}: ImageUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cropQueueRef = React.useRef<CropJob[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [cropQueue, setCropQueue] = React.useState<CropJob[]>([]);
  const hasUploadPreset = Boolean(uploadPreset?.trim());
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const activeCropJob = cropQueue[0] ?? null;
  const isUploadDisabled = isUploading || Boolean(activeCropJob) || images.length >= maxImages;

  React.useEffect(() => {
    cropQueueRef.current = cropQueue;
  }, [cropQueue]);

  React.useEffect(() => {
    return () => {
      cropQueueRef.current.forEach((job) => URL.revokeObjectURL(job.previewUrl));
    };
  }, []);

  function appendUploadedImage(uploadedImage: Pick<UploadedImage, "url" | "publicId">) {
    onImagesChange((currentImages) => {
      if (currentImages.some((image) => image.publicId === uploadedImage.publicId)) return currentImages;
      if (currentImages.length >= maxImages) {
        setError(`Maximum ${maxImages} images allowed`);
        return currentImages;
      }

      return [
        ...currentImages,
        {
          ...uploadedImage,
          order: currentImages.length,
        },
      ];
    });
  }

  function handleRemove(index: number) {
    onImagesChange((currentImages) =>
      currentImages
        .filter((_, i) => i !== index)
        .map((img, i) => ({ ...img, order: i }))
    );
    setError(null);
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) return;
    if (!hasUploadPreset || !uploadPreset?.trim() || !cloudName) {
      setError("Image uploads are temporarily unavailable because Cloudinary is not configured.");
      return;
    }

    const remainingSlots = maxImages - images.length - cropQueue.length;
    if (remainingSlots <= 0) {
      setError(`Maximum ${maxImages} images allowed`);
      return;
    }

    const filesToProcess = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > remainingSlots) {
      setError(`Only ${remainingSlots} more image${remainingSlots === 1 ? "" : "s"} can be added.`);
    } else {
      setError(null);
    }

    setIsUploading(true);
    const jobs: CropJob[] = [];

    for (const file of filesToProcess) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }

      try {
        const loadedImage = await loadImageFile(file);
        const initialCrop = getInitialCrop(loadedImage.dimensions);

        if (isTargetAspectRatio(loadedImage.dimensions)) {
          const blob = await renderCroppedImageToBlob(
            loadedImage.previewUrl,
            loadedImage.dimensions,
            initialCrop
          );
          URL.revokeObjectURL(loadedImage.previewUrl);
          const uploadedImage = await uploadCroppedImage({
            blob,
            fileName: file.name,
            uploadPreset,
            cloudName,
          });
          appendUploadedImage(uploadedImage);
          continue;
        }

        jobs.push({
          id: `${file.name}-${file.lastModified}-${createClientId()}`,
          file,
          previewUrl: loadedImage.previewUrl,
          dimensions: loadedImage.dimensions,
          initialCrop,
        });
      } catch (uploadError) {
        setError(getErrorMessage(uploadError, "Could not prepare this image. Please try another file."));
      }
    }

    if (jobs.length > 0) setCropQueue((currentQueue) => [...currentQueue, ...jobs]);
    setIsUploading(false);
  }

  async function handleCropConfirm(crop: CropPercent) {
    if (!activeCropJob || !uploadPreset?.trim() || !cloudName) return;

    setIsUploading(true);
    setError(null);

    try {
      const blob = await renderCroppedImageToBlob(
        activeCropJob.previewUrl,
        activeCropJob.dimensions,
        crop
      );
      const uploadedImage = await uploadCroppedImage({
        blob,
        fileName: activeCropJob.file.name,
        uploadPreset,
        cloudName,
      });
      appendUploadedImage(uploadedImage);
      URL.revokeObjectURL(activeCropJob.previewUrl);
      setCropQueue((currentQueue) => currentQueue.slice(1));
    } catch (uploadError) {
      setError(getErrorMessage(uploadError, "Could not upload the cropped image."));
    } finally {
      setIsUploading(false);
    }
  }

  function handleCropCancel() {
    if (!activeCropJob) return;
    URL.revokeObjectURL(activeCropJob.previewUrl);
    setCropQueue((currentQueue) => currentQueue.slice(1));
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
              className="relative aspect-[16/10] overflow-hidden rounded-md border border-border bg-surface-elevated"
            >
              <Image
                src={img.url}
                alt={`Upload ${i + 1}`}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 33vw, 160px"
                unoptimized
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
        <>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_CONSTRAINTS.allowedFormats.map((format) => `.${format}`).join(",")}
            multiple
            className="hidden"
            onChange={handleFileSelection}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={!hasUploadPreset || isUploadDisabled}
            loading={isUploading && !activeCropJob}
            onClick={() => inputRef.current?.click()}
            className="w-full"
          >
            {isUploading && !activeCropJob ? (
              "Uploading..."
            ) : (
              <>
                <ImagePlus className="h-4 w-4" />
                Add Photos
              </>
            )}
          </Button>
        </>
      )}

      {(error || !hasUploadPreset || !cloudName) && (
        <p className="text-xs text-text-error">
          {error ??
            "Image uploads are temporarily unavailable because the Cloudinary upload preset is not configured."}
        </p>
      )}

      <p className="text-xs text-text-tertiary">
        Upload up to {maxImages} photos. JPG, PNG, or WebP, max 10MB each. Images are saved at{" "}
        {LISTING_IMAGE_TARGET.aspectRatioLabel}. First image will be the main photo.
      </p>

      {activeCropJob && (
        <ImageCropDialog
          job={activeCropJob}
          isUploading={isUploading}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
        />
      )}
    </div>
  );
}

interface LoadedImageFile {
  previewUrl: string;
  dimensions: ImageDimensions;
}

interface UploadCroppedImageArgs {
  blob: Blob;
  fileName: string;
  uploadPreset: string;
  cloudName: string;
}

function validateImageFile(file: File) {
  if (file.size > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    return `${file.name} is larger than 10MB.`;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  const hasAllowedExtension = IMAGE_CONSTRAINTS.allowedFormats.some((format) => format === extension);
  const hasAllowedMimeType = IMAGE_CONSTRAINTS.allowedFormats.some((format) =>
    file.type === `image/${format === "jpg" ? "jpeg" : format}`
  );

  if (!hasAllowedExtension && !hasAllowedMimeType) {
    return `${file.name} must be a JPG, PNG, or WebP image.`;
  }

  return null;
}

function loadImageFile(file: File): Promise<LoadedImageFile> {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(file);
    const image = new window.Image();

    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };

      if (
        dimensions.width > IMAGE_CONSTRAINTS.maxWidth ||
        dimensions.height > IMAGE_CONSTRAINTS.maxHeight
      ) {
        URL.revokeObjectURL(previewUrl);
        reject(
          new Error(
            `Images must be no larger than ${IMAGE_CONSTRAINTS.maxWidth}x${IMAGE_CONSTRAINTS.maxHeight}px.`
          )
        );
        return;
      }

      resolve({ previewUrl, dimensions });
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("Could not read image dimensions."));
    };
    image.src = previewUrl;
  });
}

function isTargetAspectRatio(dimensions: ImageDimensions) {
  const imageRatio = dimensions.width / dimensions.height;
  return Math.abs(imageRatio - LISTING_IMAGE_TARGET.aspectRatio) < 0.01;
}

function getInitialCrop(dimensions: ImageDimensions): CropPercent {
  const sourceAspectRatio = dimensions.width / dimensions.height;

  if (sourceAspectRatio > LISTING_IMAGE_TARGET.aspectRatio) {
    const width = (LISTING_IMAGE_TARGET.aspectRatio / sourceAspectRatio) * 100;
    return {
      x: (100 - width) / 2,
      y: 0,
      width,
      height: 100,
    };
  }

  const height = (sourceAspectRatio / LISTING_IMAGE_TARGET.aspectRatio) * 100;
  return {
    x: 0,
    y: (100 - height) / 2,
    width: 100,
    height,
  };
}

async function renderCroppedImageToBlob(
  previewUrl: string,
  dimensions: ImageDimensions,
  crop: CropPercent
) {
  const image = await loadImageElement(previewUrl);
  const canvas = document.createElement("canvas");
  canvas.width = LISTING_IMAGE_TARGET.width;
  canvas.height = LISTING_IMAGE_TARGET.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is not available in this browser.");

  context.drawImage(
    image,
    Math.round((crop.x / 100) * dimensions.width),
    Math.round((crop.y / 100) * dimensions.height),
    Math.round((crop.width / 100) * dimensions.width),
    Math.round((crop.height / 100) * dimensions.height),
    0,
    0,
    LISTING_IMAGE_TARGET.width,
    LISTING_IMAGE_TARGET.height
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not export the cropped image."));
          return;
        }
        resolve(blob);
      },
      LISTING_IMAGE_TARGET.outputMimeType,
      LISTING_IMAGE_TARGET.outputQuality
    );
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not process the selected image."));
    image.src = src;
  });
}

async function uploadCroppedImage({
  blob,
  fileName,
  uploadPreset,
  cloudName,
}: UploadCroppedImageArgs): Promise<Pick<UploadedImage, "url" | "publicId">> {
  const formData = new FormData();
  const outputName = `${fileName.replace(/\.[^/.]+$/, "") || "listing-photo"}.webp`;
  formData.append("file", blob, outputName);
  formData.append("upload_preset", uploadPreset);
  formData.append("folder", IMAGE_CONSTRAINTS.folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => null)) as CloudinaryUploadResponse | null;

  if (!response.ok || !payload?.secure_url || !payload.public_id) {
    throw new Error(payload?.error?.message ?? "Cloudinary upload failed.");
  }

  return {
    url: payload.secure_url,
    publicId: payload.public_id,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

interface ImageCropDialogProps {
  job: CropJob;
  isUploading: boolean;
  onCancel: () => void;
  onConfirm: (crop: CropPercent) => void;
}

type CropInteractionMode = "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";

interface CropInteraction {
  mode: CropInteractionMode;
  startX: number;
  startY: number;
  areaWidth: number;
  areaHeight: number;
  startCrop: CropPercent;
}

function ImageCropDialog({
  job,
  isUploading,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const imageAreaRef = React.useRef<HTMLDivElement>(null);
  const interactionRef = React.useRef<CropInteraction | null>(null);
  const [crop, setCrop] = React.useState(job.initialCrop);

  React.useEffect(() => {
    setCrop(job.initialCrop);
  }, [job.id, job.initialCrop]);

  const sourceAspectRatio = job.dimensions.width / job.dimensions.height;

  const handlePointerMove = React.useCallback(
    (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;

      const deltaX = ((event.clientX - interaction.startX) / interaction.areaWidth) * 100;
      const deltaY = ((event.clientY - interaction.startY) / interaction.areaHeight) * 100;

      setCrop(
        interaction.mode === "move"
          ? moveCrop(interaction.startCrop, deltaX, deltaY)
          : resizeCrop(interaction.startCrop, interaction.mode, deltaX, sourceAspectRatio)
      );
    },
    [sourceAspectRatio]
  );

  const stopInteraction = React.useCallback(() => {
    interactionRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopInteraction);
  }, [handlePointerMove]);

  React.useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopInteraction);
    };
  }, [handlePointerMove, stopInteraction]);

  function startInteraction(event: React.PointerEvent, mode: CropInteractionMode) {
    const area = imageAreaRef.current?.getBoundingClientRect();
    if (!area) return;

    event.preventDefault();
    interactionRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      areaWidth: area.width,
      areaHeight: area.height,
      startCrop: crop,
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopInteraction);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl border border-white/10 bg-surface p-4 sm:p-6">
        <DialogTitle>Crop photo to {LISTING_IMAGE_TARGET.aspectRatioLabel}</DialogTitle>
        <DialogDescription>
          Move and resize the grid to choose exactly what will be uploaded and shown on the site.
        </DialogDescription>

        <div className="mt-4 rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="flex justify-center overflow-auto">
            <div ref={imageAreaRef} className="relative inline-block touch-none select-none">
              <Image
                src={job.previewUrl}
                alt={`Crop ${job.file.name}`}
                width={job.dimensions.width}
                height={job.dimensions.height}
                unoptimized
                className="block max-h-[60vh] w-auto max-w-full"
                draggable={false}
              />
              <div
                className="absolute cursor-move overflow-hidden border-2 border-neon-blue-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{
                  left: `${crop.x}%`,
                  top: `${crop.y}%`,
                  width: `${crop.width}%`,
                  height: `${crop.height}%`,
                }}
                onPointerDown={(event) => startInteraction(event, "move")}
                role="presentation"
              >
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/70" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/70" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/70" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/70" />
                <ResizeHandle position="nw" onPointerDown={startInteraction} />
                <ResizeHandle position="ne" onPointerDown={startInteraction} />
                <ResizeHandle position="sw" onPointerDown={startInteraction} />
                <ResizeHandle position="se" onPointerDown={startInteraction} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-tertiary">
            Output: {LISTING_IMAGE_TARGET.width}x{LISTING_IMAGE_TARGET.height} WebP
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCrop(job.initialCrop)}
              disabled={isUploading}
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isUploading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => onConfirm(crop)}
              loading={isUploading}
              disabled={isUploading}
            >
              <UploadCloud className="h-4 w-4" />
              Upload Crop
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ResizeHandleProps {
  position: "nw" | "ne" | "sw" | "se";
  onPointerDown: (event: React.PointerEvent, mode: CropInteractionMode) => void;
}

function ResizeHandle({ position, onPointerDown }: ResizeHandleProps) {
  const positionClassName = {
    nw: "-left-2 -top-2 cursor-nwse-resize",
    ne: "-right-2 -top-2 cursor-nesw-resize",
    sw: "-bottom-2 -left-2 cursor-nesw-resize",
    se: "-bottom-2 -right-2 cursor-nwse-resize",
  }[position];

  return (
    <button
      type="button"
      className={cn(
        "absolute h-4 w-4 rounded-full border border-white bg-neon-blue-500 shadow-lg",
        positionClassName
      )}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event, `resize-${position}`);
      }}
      aria-label={`Resize crop ${position}`}
    />
  );
}

function createClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function moveCrop(crop: CropPercent, deltaX: number, deltaY: number): CropPercent {
  return {
    ...crop,
    x: clamp(crop.x + deltaX, 0, 100 - crop.width),
    y: clamp(crop.y + deltaY, 0, 100 - crop.height),
  };
}

function resizeCrop(
  crop: CropPercent,
  mode: Exclude<CropInteractionMode, "move">,
  deltaX: number,
  sourceAspectRatio: number
): CropPercent {
  const minWidth = 20;
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  let width = mode.endsWith("e") ? crop.width + deltaX : crop.width - deltaX;
  let height = getCropHeightFromWidth(width, sourceAspectRatio);

  width = clamp(width, minWidth, 100);
  height = getCropHeightFromWidth(width, sourceAspectRatio);

  let x = mode.endsWith("e") ? crop.x : right - width;
  let y = mode.includes("s") ? crop.y : bottom - height;

  if (x < 0) {
    width = right;
    height = getCropHeightFromWidth(width, sourceAspectRatio);
    x = 0;
    if (mode.includes("n")) y = bottom - height;
  }

  if (x + width > 100) {
    width = 100 - x;
    height = getCropHeightFromWidth(width, sourceAspectRatio);
    if (mode.includes("n")) y = bottom - height;
  }

  if (y < 0) {
    height = bottom;
    width = getCropWidthFromHeight(height, sourceAspectRatio);
    y = 0;
    if (mode.endsWith("w")) x = right - width;
  }

  if (y + height > 100) {
    height = 100 - y;
    width = getCropWidthFromHeight(height, sourceAspectRatio);
    if (mode.endsWith("w")) x = right - width;
  }

  return {
    x: clamp(x, 0, 100 - width),
    y: clamp(y, 0, 100 - height),
    width: clamp(width, minWidth, 100),
    height: clamp(height, getCropHeightFromWidth(minWidth, sourceAspectRatio), 100),
  };
}

function getCropHeightFromWidth(width: number, sourceAspectRatio: number) {
  return (width * sourceAspectRatio) / LISTING_IMAGE_TARGET.aspectRatio;
}

function getCropWidthFromHeight(height: number, sourceAspectRatio: number) {
  return (height * LISTING_IMAGE_TARGET.aspectRatio) / sourceAspectRatio;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
