import { identityMismatch, isIdentityMatch } from "./live-match";
import type { LiveListingStatus, LiveMatchEvidence } from "./live-types";

const STATUS_RANK: Record<LiveListingStatus, number> = {
  inaccessible: 6,
  unverified: 5,
  empty: 4,
  placeholder: 3,
  mismatch: 2,
  drift: 1,
  pass: 0,
};

export function resolveLiveListingStatus(flags: {
  inaccessible: boolean;
  unverified?: boolean;
  empty: boolean;
  placeholder: boolean;
  mismatch: boolean;
  drift: boolean;
}): LiveListingStatus {
  if (flags.inaccessible) return "inaccessible";
  if (flags.unverified) return "unverified";
  if (flags.empty) return "empty";
  if (flags.placeholder) return "placeholder";
  if (flags.mismatch) return "mismatch";
  if (flags.drift) return "drift";
  return "pass";
}

export function liveListingFlags(input: {
  pageInaccessible: boolean;
  unverified?: boolean;
  observed: boolean;
  galleryCount: number;
  placeholder: boolean;
  match: LiveMatchEvidence;
  imageDrift: boolean;
  censusDrift: boolean;
}) {
  const inaccessible = input.pageInaccessible;
  const unverified = Boolean(input.unverified) && !inaccessible;
  const unmatched = !input.observed || !isIdentityMatch(input.match);
  const empty = !inaccessible && !unverified && input.observed && input.galleryCount === 0;
  const mismatch =
    !inaccessible &&
    !unverified &&
    input.observed &&
    (identityMismatch(input.match) || unmatched);
  return {
    inaccessible,
    unverified,
    empty,
    placeholder: !inaccessible && !unverified && !empty && input.placeholder,
    mismatch: !inaccessible && !unverified && !empty && mismatch,
    drift:
      !inaccessible &&
      !unverified &&
      !empty &&
      !mismatch &&
      (input.imageDrift || input.censusDrift || unmatched),
  };
}

export function statusRank(status: LiveListingStatus) {
  return STATUS_RANK[status];
}
