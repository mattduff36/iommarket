import {
  formatPreviewReviewReason,
  NEEDS_MANUAL_REVIEW_BADGE,
  NO_IMAGE_REVIEW_PLACEHOLDER,
  previewSourceHref,
  uniquePreviewReviewReasons,
} from "@/lib/preview-packs/review";

export function PreviewReviewImagePlaceholder({
  reasons,
  sourceUrl,
  sourceIdentityKey,
  compact = false,
}: {
  reasons?: readonly string[];
  sourceUrl?: string | null;
  sourceIdentityKey?: string | null;
  compact?: boolean;
}) {
  const uniqueReasons = uniquePreviewReviewReasons(reasons ?? []).filter((reason) =>
    /image|photo|placeholder/i.test(reason),
  );
  const href = previewSourceHref(sourceUrl);

  if (compact) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center"
        data-testid="preview-review-no-image"
      >
        <span className="text-xs font-semibold text-premium-gold-400">
          {NEEDS_MANUAL_REVIEW_BADGE}
        </span>
        <span className="text-[11px] text-metallic-500">{NO_IMAGE_REVIEW_PLACEHOLDER}</span>
      </div>
    );
  }

  return (
    <div
      className="flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-lg border border-premium-gold-500/30 bg-graphite-800 px-6 text-center"
      data-testid="preview-review-no-image"
    >
      <p className="text-sm font-semibold text-premium-gold-400">{NEEDS_MANUAL_REVIEW_BADGE}</p>
      <p className="text-sm text-metallic-400">{NO_IMAGE_REVIEW_PLACEHOLDER}</p>
      {uniqueReasons.length > 0 ? (
        <ul className="space-y-1 text-xs text-text-tertiary">
          {uniqueReasons.map((reason) => (
            <li key={reason}>{formatPreviewReviewReason(reason)}</li>
          ))}
        </ul>
      ) : null}
      {sourceIdentityKey ? (
        <p className="text-xs text-text-tertiary">
          Source identity <span className="font-mono">{sourceIdentityKey}</span>
        </p>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-neon-blue-400 hover:text-neon-blue-500"
        >
          View source listing
        </a>
      ) : null}
    </div>
  );
}
