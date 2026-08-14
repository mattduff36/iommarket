"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import type { ListingPhotoSource } from "@/lib/images/photo";

interface ListingPhotoFocalDialogProps {
  photo: ListingPhotoSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (focal: { focalX: number; focalY: number } | { focalX: null; focalY: null }) => void;
}

export function ListingPhotoFocalDialog({
  photo,
  open,
  onOpenChange,
  onSave,
}: ListingPhotoFocalDialogProps) {
  const [focal, setFocal] = React.useState<{ x: number; y: number } | null>(
    photo.focalX != null && photo.focalY != null ? { x: photo.focalX, y: photo.focalY } : null,
  );

  React.useEffect(() => {
    setFocal(
      photo.focalX != null && photo.focalY != null ? { x: photo.focalX, y: photo.focalY } : null,
    );
  }, [photo.focalX, photo.focalY, photo.publicId]);

  const previewPhoto: ListingPhotoSource = {
    ...photo,
    focalX: focal?.x ?? null,
    focalY: focal?.y ?? null,
  };

  function handlePick(event: React.MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    setFocal({ x, y });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl border border-white/10 bg-surface p-4 sm:p-6">
        <DialogTitle>Adjust photo focus</DialogTitle>
        <DialogDescription>
          Automatic focus keeps the important subject in view. Click the photo to choose a focus
          point for cropped cards and gallery frames.
        </DialogDescription>

        <button
          type="button"
          onClick={handlePick}
          className="relative mt-4 block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
          aria-label="Choose photo focus point"
        >
          <ListingPhoto
            photo={previewPhoto}
            frame="gallery"
            alt="Focus preview"
            sizes="(max-width: 768px) 100vw, 720px"
          />
          {focal ? (
            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neon-blue-500 shadow-lg"
              style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
            />
          ) : null}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <ListingPhoto
            photo={previewPhoto}
            frame="card"
            alt="Card preview"
            sizes="200px"
            className="rounded-md"
          />
          <ListingPhoto
            photo={previewPhoto}
            frame="gallery"
            alt="Gallery preview"
            sizes="200px"
            className="rounded-md"
          />
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFocal(null);
              onSave({ focalX: null, focalY: null });
            }}
          >
            Automatic
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (focal) onSave({ focalX: focal.x, focalY: focal.y });
              onOpenChange(false);
            }}
          >
            Save focus
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
