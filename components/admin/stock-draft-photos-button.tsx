"use client";

import { useState } from "react";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";
import { loadAdminStockDraftPhotos, saveAdminStockDraftPhotos } from "@/actions/admin/stock-draft-photos";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReportableError } from "@/components/monitoring/reportable-error";

export function StockDraftPhotosButton({ listingId, onSaved }: { listingId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [revision, setRevision] = useState(0);
  const [maxImages, setMaxImages] = useState(20);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOpen(true); setBusy(true); setError(null); setLoaded(false);
    try {
      const result = await loadAdminStockDraftPhotos(listingId);
      if (!result.data) { setError(result.error); return; }
      setImages(result.data.images.map(image => ({ ...image, uploadIntentId: image.uploadIntentId ?? `existing-${image.id}` })));
      setRevision(result.data.photoRevision); setMaxImages(result.data.maxImages); setLoaded(true);
    } catch { setError("The photos could not be loaded. Close and reopen this editor."); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const result = await saveAdminStockDraftPhotos({ listingId, input: {
        basePhotoRevision: revision, mutationId: crypto.randomUUID(),
        photos: images.map(image => ({ ...(image.id ? { imageId: image.id } : { uploadIntentId: image.uploadIntentId }),
          focalX: image.focalX ?? null, focalY: image.focalY ?? null })),
      } });
      if (result.error) { setError(result.error); return; }
      setOpen(false); onSaved();
    } catch { setError("The photo save could not be confirmed. Close and reopen the editor before retrying."); }
    finally { setBusy(false); }
  }
  return <div data-stock-review-editing={open ? "true" : undefined}>
    <Button type="button" size="sm" variant="ghost" className="mt-2 border border-border" onClick={load}>Edit draft photos</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy && !uploading) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Recalled draft photos</DialogTitle><DialogDescription>Saved dealer photos remain until you explicitly save replacements. Upload at least two verified photos before sending to moderation. Closing without saving leaves the listing unchanged.</DialogDescription></DialogHeader>
        {error && <ReportableError role="alert">{error}</ReportableError>}
        <fieldset disabled={busy}><ImageUpload images={images} onImagesChange={setImages} onBusyChange={setUploading} maxImages={maxImages} stockReviewListingId={listingId} /></fieldset>
        <Button type="button" disabled={!loaded || busy || uploading} onClick={save}>Save photos</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
