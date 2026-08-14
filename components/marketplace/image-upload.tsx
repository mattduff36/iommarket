"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImagePlus, Star, X } from "lucide-react";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import { ListingPhotoFocalDialog } from "@/components/marketplace/listing-photo-focal-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { LISTING_IMAGE_ACCEPT } from "@/lib/images/constraints";
import { uploadListingImageFile, validateListingImageFile } from "@/lib/images/client-upload";
import type { ListingPhotoSource } from "@/lib/images/photo";

export interface UploadedImage extends ListingPhotoSource {
  uploadIntentId: string;
  order: number;
}

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: React.Dispatch<React.SetStateAction<UploadedImage[]>>;
  maxImages?: number;
}

interface PendingSlot {
  clientId: string;
  fileName: string;
  error?: string;
}

function createClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function ImageUpload({
  images,
  onImagesChange,
  maxImages = 10,
}: ImageUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingSlot[]>([]);
  const [announcement, setAnnouncement] = React.useState("");
  const [focalImage, setFocalImage] = React.useState<UploadedImage | null>(null);
  const isBusy = pending.length > 0;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function reorder(next: UploadedImage[], message: string) {
    onImagesChange(next.map((image, order) => ({ ...image, order })));
    setAnnouncement(message);
  }

  function handleRemove(index: number) {
    reorder(
      images.filter((_, current) => current !== index),
      `Removed photo ${index + 1}.`,
    );
    setError(null);
  }

  function moveImage(index: number, nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= images.length) return;
    const next = arrayMove(images, index, nextIndex);
    const becamePrimary = nextIndex === 0 ? `${next[0]?.publicId ?? "Photo"} is now primary.` : "";
    reorder(next, `Moved photo to position ${nextIndex + 1}. ${becamePrimary}`.trim());
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.findIndex((image) => image.uploadIntentId === active.id);
    const newIndex = images.findIndex((image) => image.uploadIntentId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    moveImage(oldIndex, newIndex);
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    const remainingSlots = maxImages - images.length - pending.length;
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

    const slots = filesToProcess.map((file) => ({
      clientId: `${file.name}-${file.lastModified}-${createClientId()}`,
      fileName: file.name,
    }));
    setPending((current) => [...current, ...slots]);

    const reserved = await Promise.all(
      filesToProcess.map(async (file, index) => {
        const slot = slots[index];
        const validationError = validateListingImageFile(file);
        if (validationError) {
          setPending((current) => current.filter((item) => item.clientId !== slot.clientId));
          setError(validationError);
          return null;
        }

        try {
          const uploaded = await uploadListingImageFile(file);
          setPending((current) => current.filter((item) => item.clientId !== slot.clientId));
          return {
            ...uploaded,
            uploadIntentId: uploaded.uploadIntentId!,
            order: 0,
            url:
              uploaded.url ||
              `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/private/f_auto,q_auto/${uploaded.publicId}`,
          } satisfies UploadedImage;
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Could not upload this image.";
          setPending((current) => current.filter((item) => item.clientId !== slot.clientId));
          setError(message);
          return null;
        }
      }),
    );

    onImagesChange((current) => {
      const next = [...current];
      for (const uploaded of reserved) {
        if (!uploaded || next.some((image) => image.uploadIntentId === uploaded.uploadIntentId)) {
          continue;
        }
        next.push({ ...uploaded, order: next.length });
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">
          Photos ({images.length}/{maxImages})
        </label>
      </div>

      {(images.length > 0 || pending.length > 0) && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={images.map((image) => image.uploadIntentId)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-3 gap-3" data-testid="listing-photo-grid">
              {images.map((image, index) => (
                <SortablePhoto
                  key={image.uploadIntentId}
                  image={image}
                  index={index}
                  disabled={isBusy}
                  onRemove={() => handleRemove(index)}
                  onMovePrevious={() => moveImage(index, index - 1)}
                  onMoveNext={() => moveImage(index, index + 1)}
                  onMakePrimary={() => moveImage(index, 0)}
                  onAdjustFocus={() => setFocalImage(image)}
                />
              ))}
              {pending.map((slot) => (
                <div
                  key={slot.clientId}
                  className="flex aspect-[16/10] items-center justify-center rounded-md border border-dashed border-border bg-surface-elevated px-2 text-center text-[11px] text-text-secondary"
                >
                  {slot.error ? slot.error : `Uploading ${slot.fileName}…`}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {images.length < maxImages && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={LISTING_IMAGE_ACCEPT}
            multiple
            className="hidden"
            onChange={handleFileSelection}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={isBusy || images.length >= maxImages}
            loading={isBusy}
            onClick={() => inputRef.current?.click()}
            className="w-full"
          >
            {isBusy ? (
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

      {error ? <p className="text-xs text-text-error">{error}</p> : null}
      <p className="text-xs text-text-tertiary">
        Upload up to {maxImages} photos. JPG, PNG, WebP, HEIC or HEIF, max 10MB each. Drag photos
        to change the order. The first image is the main photo.
      </p>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      {focalImage ? (
        <ListingPhotoFocalDialog
          photo={focalImage}
          open
          onOpenChange={(open) => {
            if (!open) setFocalImage(null);
          }}
          onSave={(focal) => {
            onImagesChange((current) =>
              current.map((image) =>
                image.uploadIntentId === focalImage.uploadIntentId
                  ? { ...image, ...focal }
                  : image,
              ),
            );
            setFocalImage(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface SortablePhotoProps {
  image: UploadedImage;
  index: number;
  disabled: boolean;
  onRemove: () => void;
  onMovePrevious: () => void;
  onMoveNext: () => void;
  onMakePrimary: () => void;
  onAdjustFocus: () => void;
}

function SortablePhoto({
  image,
  index,
  disabled,
  onRemove,
  onMovePrevious,
  onMoveNext,
  onMakePrimary,
  onAdjustFocus,
}: SortablePhotoProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: image.uploadIntentId, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-surface-elevated",
        isDragging && "z-10 shadow-high",
      )}
      data-testid={`listing-photo-${index}`}
    >
      <ListingPhoto
        photo={image}
        frame="preview"
        alt={`Upload ${index + 1}`}
        sizes="(max-width: 768px) 33vw, 160px"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="absolute top-1 left-1 h-7 w-7 touch-none rounded-full bg-black/60 text-white hover:bg-black/80"
        aria-label={`Drag to reorder photo ${index + 1}`}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white hover:bg-black/80"
        aria-label={`Remove image ${index + 1}`}
      >
        <X className="h-3 w-3" />
      </Button>
      {index === 0 ? (
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Main
        </span>
      ) : null}
      <div className="absolute inset-x-1 bottom-7 flex flex-wrap justify-end gap-1">
        <Button type="button" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={onAdjustFocus}>
          Adjust focus
        </Button>
        {index > 0 ? (
          <>
            <Button type="button" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={onMovePrevious}>
              Move previous
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              onClick={onMakePrimary}
            >
              <Star className="h-3 w-3" />
              Make primary
            </Button>
          </>
        ) : null}
        <Button type="button" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={onMoveNext}>
          Move next
        </Button>
      </div>
    </div>
  );
}
