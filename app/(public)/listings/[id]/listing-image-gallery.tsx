"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface ListingGalleryImage {
  id: string;
  url: string;
}

interface ListingImageGalleryProps {
  images: ListingGalleryImage[];
  title: string;
  isSold: boolean;
}

export function ListingImageGallery({
  images,
  title,
  isSold,
}: ListingImageGalleryProps) {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = React.useState(false);
  const activeImage = images[activeIndex] ?? images[0];
  const canNavigate = images.length > 1;

  function showImage(index: number) {
    setActiveIndex(Math.min(Math.max(index, 0), images.length - 1));
  }

  function showPrevious() {
    if (!canNavigate) return;
    setActiveIndex((currentIndex) =>
      currentIndex === 0 ? images.length - 1 : currentIndex - 1
    );
  }

  function showNext() {
    if (!canNavigate) return;
    setActiveIndex((currentIndex) =>
      currentIndex === images.length - 1 ? 0 : currentIndex + 1
    );
  }

  function handleLightboxKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPrevious();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showNext();
    }
  }

  if (!activeImage) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-lg bg-graphite-800 text-metallic-500">
        No images available
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => setIsLightboxOpen(true)}
          className="group relative aspect-[16/10] overflow-hidden rounded-lg bg-graphite-800 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          aria-label={`Open image gallery for ${title}`}
        >
          <Image
            src={activeImage.url}
            alt={title}
            fill
            className={cn(
              "object-cover transition duration-300 group-hover:scale-[1.015]",
              isSold && "brightness-75"
            )}
            priority
            sizes="(max-width: 768px) 100vw, 66vw"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-10 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Tap to view all photos
          </div>
          {isSold && <SoldStamp />}
        </button>

        {images.length > 1 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {images.map((image, index) => {
              const isActive = index === activeIndex;

              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => showImage(index)}
                  className={cn(
                    "relative aspect-[16/10] overflow-hidden rounded-lg bg-graphite-800",
                    "border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                    isActive
                      ? "border-neon-blue-500 shadow-[0_0_0_1px_rgba(66,153,225,0.8)]"
                      : "border-white/10 hover:border-white/35"
                  )}
                  aria-label={`Show image ${index + 1} of ${images.length}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <Image
                    src={image.url}
                    alt={`${title} image ${index + 1}`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 50vw, 16vw"
                  />
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent
          className="left-0 top-0 h-dvh max-w-none translate-x-0 translate-y-0 rounded-none border-none bg-black p-0 shadow-none"
          onKeyDown={handleLightboxKeyDown}
        >
          <DialogTitle className="sr-only">{title} photos</DialogTitle>
          <DialogDescription className="sr-only">
            Browse all listing photos. Use the previous and next controls or
            arrow keys to change image.
          </DialogDescription>

          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1">
              <Image
                src={activeImage.url}
                alt={`${title} image ${activeIndex + 1}`}
                fill
                className="object-contain"
                sizes="100vw"
                priority
              />

              {canNavigate && (
                <>
                  <div className="absolute inset-y-0 left-3 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={showPrevious}
                      className="h-12 w-12 rounded-full border border-white/15 bg-black/60 text-white hover:bg-white/15"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                  </div>
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={showNext}
                      className="h-12 w-12 rounded-full border border-white/15 bg-black/60 text-white hover:bg-white/15"
                      aria-label="Next image"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-white/10 bg-black/90 px-4 py-3">
              <div className="mb-3 text-center text-sm font-medium text-white">
                {activeIndex + 1} / {images.length}
              </div>
              {canNavigate && (
                <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto pb-1">
                  {images.map((image, index) => {
                    const isActive = index === activeIndex;

                    return (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => showImage(index)}
                        className={cn(
                          "relative h-16 w-28 shrink-0 overflow-hidden rounded-md border bg-graphite-900",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500",
                          isActive ? "border-neon-blue-500" : "border-white/15"
                        )}
                        aria-label={`Show image ${index + 1}`}
                        aria-current={isActive ? "true" : undefined}
                      >
                        <Image
                          src={image.url}
                          alt={`${title} thumbnail ${index + 1}`}
                          fill
                          className="object-cover"
                          sizes="112px"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SoldStamp() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rotate-[-20deg] rounded-sm border-[6px] border-white px-6 py-2 text-5xl font-black tracking-widest text-white opacity-90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
        SOLD
      </span>
    </div>
  );
}
