import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import type { ListingPhotoSource } from "@/lib/images/photo";
import {
  buildRevisionFieldDiffs,
  revisionPhotosChanged,
  type RevisionPreviewSide,
} from "@/lib/listings/revision-preview";

export function PendingRevisionReview({
  live,
  proposed,
  proposedPhotos,
}: {
  live: RevisionPreviewSide;
  proposed: RevisionPreviewSide;
  proposedPhotos: ListingPhotoSource[];
}) {
  const diffs = buildRevisionFieldDiffs(live, proposed);
  const photosChanged = revisionPhotosChanged(live, proposed);

  return (
    <Card className="mb-8 border-premium-gold-500/40">
      <CardHeader>
        <CardTitle>Proposed edits awaiting review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-text-secondary">
          The live listing below stays public. Approve applies these changes; reject leaves the live listing unchanged.
        </p>
        {diffs.length === 0 && !photosChanged ? (
          <p className="text-sm text-text-secondary">No field differences from the live listing.</p>
        ) : (
          <dl className="grid gap-3 text-sm">
            {diffs.map((diff) => (
              <div key={diff.field} className="rounded-md border border-border p-3">
                <dt className="font-medium text-text-primary">{diff.field}</dt>
                <dd className="mt-1 text-text-secondary">
                  <span className="block">Live: {diff.live}</span>
                  <span className="block">Proposed: {diff.proposed}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Proposed photos</h3>
          {proposedPhotos.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">No proposed photos.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {proposedPhotos.map((photo, index) => (
                <li key={photo.publicId} className="overflow-hidden rounded-md border border-border">
                  <ListingPhoto
                    photo={photo}
                    frame="admin"
                    alt={`Proposed photo ${index + 1}`}
                    sizes="160px"
                    className="aspect-square"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        {proposed.description !== live.description ? (
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Proposed description</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
              {proposed.description}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
