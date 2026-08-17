"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import { hasValidFocalPoint, type ListingPhotoSource } from "@/lib/images/photo";

interface ListingPhotoFocalDialogProps {
  photo: ListingPhotoSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (focal: { focalX: number; focalY: number } | { focalX: null; focalY: null }) => void;
}

const FOCAL_STEP = 0.01;
const FOCAL_LARGE_STEP = 0.05;

function clampCoordinate(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeCoordinate(value: number) {
  return Number(clampCoordinate(value).toFixed(4));
}

function focalFromPhoto(photo: ListingPhotoSource) {
  return hasValidFocalPoint(photo)
    ? { x: normalizeCoordinate(photo.focalX!), y: normalizeCoordinate(photo.focalY!) }
    : null;
}

export function ListingPhotoFocalDialog({
  photo,
  open,
  onOpenChange,
  onSave,
}: ListingPhotoFocalDialogProps) {
  const statusId = React.useId();
  const helpId = React.useId();
  const [focal, setFocal] = React.useState<{ x: number; y: number } | null>(() =>
    focalFromPhoto(photo),
  );
  const activePointerIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setFocal(focalFromPhoto(photo));
  }, [photo]);

  const previewPhoto: ListingPhotoSource = {
    ...photo,
    focalX: focal?.x ?? null,
    focalY: focal?.y ?? null,
  };

  function setFocalFromPoint(element: HTMLButtonElement, clientX: number, clientY: number) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setFocal({ x: 0.5, y: 0.5 });
      return;
    }
    setFocal({
      x: normalizeCoordinate((clientX - rect.left) / rect.width),
      y: normalizeCoordinate((clientY - rect.top) / rect.height),
    });
  }

  function handlePick(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) return;
    setFocalFromPoint(event.currentTarget, event.clientX, event.clientY);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setFocalFromPoint(event.currentTarget, event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (activePointerIdRef.current !== event.pointerId) return;
    setFocalFromPoint(event.currentTarget, event.clientX, event.clientY);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLButtonElement>) {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (event.key === "Home") {
      setFocal({ x: 0.5, y: 0.5 });
      return;
    }
    const step = event.shiftKey ? FOCAL_LARGE_STEP : FOCAL_STEP;
    setFocal((current) => {
      const next = current ?? { x: 0.5, y: 0.5 };
      return {
        x: normalizeCoordinate(
          next.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
        ),
        y: normalizeCoordinate(
          next.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
        ),
      };
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl border border-white/10 bg-surface p-4 sm:p-6">
        <DialogTitle>Adjust photo focus</DialogTitle>
        <DialogDescription>
          Choose the part of the photo that should stay visible in cards and gallery frames. Tap,
          drag, or use the arrow keys to position the focus point.
        </DialogDescription>

        <button
          type="button"
          onClick={handlePick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleKeyDown}
          className="relative mt-4 block min-h-44 w-full touch-none cursor-crosshair overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          aria-label="Choose photo focus point"
          aria-describedby={`${statusId} ${helpId}`}
        >
          <ListingPhoto
            photo={previewPhoto}
            frame="gallery"
            alt="Focus preview"
            sizes="(max-width: 768px) 100vw, 720px"
            className="pointer-events-none"
          />
          {focal ? (
            <span
              className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neon-blue-500 shadow-lg ring-4 ring-black/45"
              style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
            />
          ) : null}
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p id={statusId} className="font-medium text-text-primary" aria-live="polite">
            {focal
              ? `Focus: ${Math.round(focal.x * 100)}% across, ${Math.round(focal.y * 100)}% down`
              : "Focus: automatic"}
          </p>
          <p id={helpId} className="text-xs text-text-tertiary">
            Arrow keys move 1%; hold Shift for 5%. Home centres.
          </p>
        </div>

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
              onOpenChange(false);
            }}
          >
            Use automatic focus
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!focal}
            onClick={() => {
              if (focal) {
                onSave({
                  focalX: normalizeCoordinate(focal.x),
                  focalY: normalizeCoordinate(focal.y),
                });
              }
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
