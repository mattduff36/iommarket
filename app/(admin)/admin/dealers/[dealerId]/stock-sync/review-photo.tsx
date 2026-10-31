"use client";

import { ReportableError } from "@/components/monitoring/reportable-error";
import { useState } from "react";

/** These are the same vehicle's reviewed source candidates, never arbitrary replacement photos. */
export function StockReviewPhoto({ photos, title }: { photos: string[]; title: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const photo = photos.find(candidate => !failed.includes(candidate));
  if (!photo) return <ReportableError as="div" role="alert" className="w-24 shrink-0 text-xs text-text-secondary">Source photos unavailable</ReportableError>;
  return (
    <div className="w-24 shrink-0">
    <a href={photo} target="_blank" rel="noreferrer" aria-label={`View photo of ${title}`}>
      {/* Source evidence must not pass through the managed listing-image provider. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={photo} src={photo} alt={title} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(current => current.includes(photo) ? current : [...current, photo])}
        className="h-16 w-24 rounded-md object-cover" />
    </a>
    {failed.length > 0 ? <ReportableError as="p" data-reportable-error="true" className="mt-1 text-xs text-text-secondary" role="status">A source photo is unavailable. Check photos before approval.</ReportableError> : null}
    </div>
  );
}
