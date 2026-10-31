"use client";

import { useState } from "react";

/** These are the same vehicle's reviewed source candidates, never arbitrary replacement photos. */
export function StockReviewPhoto({ photos, title }: { photos: string[]; title: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const photo = photos.find(candidate => !failed.includes(candidate));
  if (!photo) return <span className="flex h-16 w-24 shrink-0 items-center text-xs text-text-secondary">Source photos unavailable</span>;
  return (
    <div className="w-24 shrink-0">
    <a href={photo} target="_blank" rel="noreferrer" aria-label={`View photo of ${title}`}>
      {/* Source evidence must not pass through the managed listing-image provider. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={photo} src={photo} alt={title} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(current => current.includes(photo) ? current : [...current, photo])}
        className="h-16 w-24 rounded-md object-cover" />
    </a>
    {failed.length > 0 ? <p className="mt-1 text-xs text-text-secondary" role="status">A source photo is unavailable. Check photos before approval.</p> : null}
    </div>
  );
}
