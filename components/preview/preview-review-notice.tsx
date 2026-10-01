import { Badge } from "@/components/ui/badge";
import {
  formatPreviewReviewReason,
  NEEDS_MANUAL_REVIEW_BADGE,
  previewSourceHref,
  uniquePreviewReviewReasons,
} from "@/lib/preview-packs/review";

export function PreviewReviewNotice({
  reasons,
  sourceUrl,
  sourceRunId,
  sourceIdentityKey,
  className,
}: {
  reasons?: readonly string[];
  sourceUrl?: string | null;
  sourceRunId?: string | null;
  sourceIdentityKey?: string | null;
  className?: string;
}) {
  const uniqueReasons = uniquePreviewReviewReasons(reasons ?? []);
  const href = previewSourceHref(sourceUrl) ?? previewSourceHref(sourceRunId);
  const runLabel = sourceRunId && !previewSourceHref(sourceRunId) ? sourceRunId : null;

  return (
    <div className={className}>
      <Badge variant="warning">{NEEDS_MANUAL_REVIEW_BADGE}</Badge>
      {uniqueReasons.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
          {uniqueReasons.map((reason) => (
            <li key={reason}>{formatPreviewReviewReason(reason)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-text-secondary">
          This preview record needs a staff check before it can be trusted.
        </p>
      )}
      {sourceIdentityKey ? (
        <p className="mt-2 text-xs text-text-tertiary">
          Source identity <span className="font-mono">{sourceIdentityKey}</span>
        </p>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-neon-blue-400 hover:text-neon-blue-500"
        >
          View source listing
        </a>
      ) : null}
      {runLabel ? (
        <p className="mt-2 text-xs text-text-tertiary">
          Source run <span className="font-mono">{runLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
