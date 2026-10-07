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
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  GripVertical,
  ImagePlus,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import { ListingPhotoFocalDialog } from "@/components/marketplace/listing-photo-focal-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { buildCanonicalListingImageUrl } from "@/lib/images/cloudinary-url";
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
    const becameCover =
      nextIndex === 0 ? `Photo ${nextIndex + 1} is now the cover photo.` : "";
    reorder(next, `Moved photo to position ${nextIndex + 1}. ${becameCover}`.trim());
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
            url: buildCanonicalListingImageUrl({
              ...uploaded,
              url: uploaded.url,
            }),
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
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="listing-photo-grid"
            >
              {images.map((image, index) => (
                <SortablePhoto
                  key={image.uploadIntentId}
                  image={image}
                  index={index}
                  isLast={index === images.length - 1}
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
                  className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-border bg-surface-elevated px-4 text-center text-sm text-text-secondary"
                  role="status"
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

      {error ? (
        <p className="text-sm text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-text-tertiary">
        Upload up to {maxImages} photos. JPG, PNG, WebP, HEIC or HEIF, max 10MB each. The first
        photo is the cover photo. Drag photos or use the move controls to change the order.
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
  isLast: boolean;
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
  isLast,
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
        "overflow-hidden rounded-lg border border-border bg-surface-elevated",
        isDragging && "z-10 shadow-high",
      )}
      data-testid={`listing-photo-${index}`}
    >
      <div className="relative">
        <ListingPhoto
          photo={image}
          frame="preview"
          alt={`Upload ${index + 1}`}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/70 px-3 py-2 text-xs text-white">
          <span className="font-semibold">{index === 0 ? "Cover photo" : `Photo ${index + 1}`}</span>
          {image.focalX != null && image.focalY != null ? <span>Focus set</span> : null}
        </div>
      </div>
      <div
        className="grid grid-cols-[2.75rem_1fr_1fr_2.75rem] border-t border-border"
        role="group"
        aria-label={`Controls for photo ${index + 1}`}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="h-11 w-11 touch-none rounded-none border-r border-border"
          aria-label={`Drag to reorder photo ${index + 1}`}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onMovePrevious}
          disabled={disabled || index === 0}
          className="h-11 min-w-0 rounded-none border-r border-border px-2 text-xs"
          aria-label={`Move photo ${index + 1} left`}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span>Left</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onMoveNext}
          disabled={disabled || isLast}
          className="h-11 min-w-0 rounded-none border-r border-border px-2 text-xs"
          aria-label={`Move photo ${index + 1} right`}
        >
          <span>Right</span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="h-11 w-11 rounded-none"
              aria-label={`More actions for photo ${index + 1}`}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Photo {index + 1}</DropdownMenuLabel>
            <DropdownMenuItem className="min-h-11 gap-2" onSelect={onAdjustFocus}>
              <Crosshair className="h-4 w-4" />
              Adjust focus
            </DropdownMenuItem>
            {index > 0 ? (
              <DropdownMenuItem className="min-h-11 gap-2" onSelect={onMakePrimary}>
                <Star className="h-4 w-4" />
                Make cover photo
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 gap-2 text-text-error focus:text-text-error"
              onSelect={onRemove}
            >
              <Trash2 className="h-4 w-4" />
              Remove photo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
