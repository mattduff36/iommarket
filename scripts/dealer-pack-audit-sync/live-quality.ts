import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  assertSafeRemoteImageUrl as assertPublicHttpsImageUrl,
  downloadSafeRemoteImage,
  isPublicIpAddress,
  type AddressLookup,
  type PinnedImageTransport,
} from "../../lib/images/safe-remote-image";
import {
  imageIdentityKey,
  parseNetDirectorImageToken,
} from "../dealer-stock-sync/image-urls";
import {
  frozenImageQualityError,
  inspectFrozenImage,
} from "./image-quality";
import { galleryIdentityKey, imagePathname } from "./live-observe";
import type { LiveImageSignal } from "./live-types";

export const LIVE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const LIVE_IMAGE_TIMEOUT_MS = 10_000;

const PLACEHOLDER_URL =
  /placeholder|no[-_]?image|1x1|spacer|blank\.gif|default[-_]?image|coming[-_]?soon|waiting[-_]?for[-_]?image|image[-_]?missing|nophoto|without[-_]?photo/i;

export interface LiveRemoteImage {
  url: string;
  bytes: Buffer;
  contentType: string | null;
  status: number;
}

export interface LiveImageFetchError {
  url: string;
  error: string;
}

export type LiveImageFetchResult = LiveRemoteImage | LiveImageFetchError;

export type LiveImageFetcher = (url: string) => Promise<LiveImageFetchResult>;

export function isSafeRemoteImageUrl(url: string) {
  try {
    assertSafeRemoteImageUrl(url);
    return true;
  } catch {
    return false;
  }
}

export function assertSafeRemoteImageUrl(url: string) {
  let parsed: URL;
  try {
    parsed = assertPublicHttpsImageUrl(url);
  } catch {
    throw new Error(`Refusing remote image fetch: unsafe URL ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    throw new Error(`Refusing remote image fetch: unsafe URL ${url}`);
  }
  if (isIP(host) && !isPublicIpAddress(host)) {
    throw new Error(`Refusing remote image fetch: unsafe URL ${url}`);
  }
  return parsed;
}

export function isPlaceholderImageUrl(url: string | null | undefined) {
  if (!url) return false;
  const token = parseNetDirectorImageToken(url);
  return PLACEHOLDER_URL.test(token?.key ?? url);
}

export function placeholderReasons(input: {
  url: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  qualityError: string | null;
}) {
  const reasons: string[] = [];
  if (isPlaceholderImageUrl(input.url)) reasons.push("placeholder-url");
  if (
    input.width != null &&
    input.height != null &&
    (Math.max(input.width, input.height) < 200 ||
      Math.min(input.width, input.height) < 150)
  ) {
    reasons.push("placeholder-dimensions");
  }
  if (input.bytes != null && input.bytes > 0 && input.bytes < 2_048) {
    reasons.push("placeholder-bytes");
  }
  if (input.qualityError) reasons.push(`quality:${input.qualityError}`);
  return reasons;
}

export function checksumImageBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function inspectLiveImageBytes(url: string, bytes: Buffer): LiveImageSignal {
  const metadata = inspectFrozenImage(bytes);
  const qualityError = frozenImageQualityError(metadata);
  const width = metadata?.width ?? null;
  const height = metadata?.height ?? null;
  const reasons = placeholderReasons({
    url,
    width,
    height,
    bytes: bytes.length,
    qualityError,
  });
  return {
    url,
    checksum: checksumImageBytes(bytes),
    width,
    height,
    format: metadata?.format ?? null,
    bytes: bytes.length,
    qualityError,
    placeholder: reasons.some((reason) => reason.startsWith("placeholder-")),
    reasons,
  };
}

export function inaccessibleImageSignal(url: string, error: string): LiveImageSignal {
  return {
    url,
    checksum: null,
    width: null,
    height: null,
    format: null,
    bytes: null,
    qualityError: error,
    placeholder: isPlaceholderImageUrl(url),
    reasons: isPlaceholderImageUrl(url)
      ? ["placeholder-url", `fetch:${error}`]
      : [`fetch:${error}`],
  };
}

export async function inspectRemoteImage(
  url: string,
  fetchImage: LiveImageFetcher,
): Promise<LiveImageSignal> {
  if (!isSafeRemoteImageUrl(url)) {
    return inaccessibleImageSignal(url, "unsafe-url");
  }
  try {
    const result = await fetchImage(url);
    if ("error" in result) return inaccessibleImageSignal(url, result.error);
    if (result.bytes.length > LIVE_IMAGE_MAX_BYTES) {
      return inaccessibleImageSignal(url, "image-exceeds-max-bytes");
    }
    const type = result.contentType?.toLowerCase() ?? "";
    if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
      return inaccessibleImageSignal(url, `unexpected-content-type:${type}`);
    }
    return inspectLiveImageBytes(url, result.bytes);
  } catch (error) {
    return inaccessibleImageSignal(
      url,
      error instanceof Error ? error.message : "image-fetch-failed",
    );
  }
}

export async function safeFetchRemoteImage(
  url: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    lookupImpl?: AddressLookup;
    transport?: PinnedImageTransport;
  } = {},
): Promise<LiveImageFetchResult> {
  try {
    assertSafeRemoteImageUrl(url);
    const downloaded = await downloadSafeRemoteImage({
      url,
      lookupImpl: options.lookupImpl,
      transport: options.transport,
      maxBytes: options.maxBytes ?? LIVE_IMAGE_MAX_BYTES,
      timeoutMs: options.timeoutMs ?? LIVE_IMAGE_TIMEOUT_MS,
    });
    return {
      url,
      bytes: downloaded.bytes,
      contentType: downloaded.contentType,
      status: 200,
    };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : "image-fetch-failed",
    };
  }
}

export function liveImagesEquivalent(
  plannedUrl: string,
  observedUrl: string,
  canonicalize: (url: string) => string | null = (url) => url,
) {
  const plannedIdentity = galleryIdentityKey(plannedUrl);
  const observedIdentity = galleryIdentityKey(observedUrl);
  if (plannedIdentity && observedIdentity && plannedIdentity === observedIdentity) {
    return true;
  }
  try {
    if (imageIdentityKey(plannedUrl) === imageIdentityKey(observedUrl)) return true;
  } catch {
    // Fall through to path and canonical comparison.
  }
  const plannedPath = imagePathname(plannedUrl);
  const observedPath = imagePathname(observedUrl);
  if (
    plannedPath &&
    observedPath &&
    (plannedPath === observedPath ||
      observedPath.endsWith(plannedPath) ||
      plannedPath.endsWith(observedPath))
  ) {
    return true;
  }
  const plannedCanonical = canonicalize(plannedUrl);
  const observedCanonical = canonicalize(observedUrl);
  return Boolean(plannedCanonical && observedCanonical && plannedCanonical === observedCanonical);
}

function checksumsAreOrderedSubsequence(
  plannedChecksums: string[],
  observedChecksums: Array<string | null>,
) {
  if (plannedChecksums.length === 0) return true;
  let next = 0;
  for (const checksum of observedChecksums) {
    if (next >= plannedChecksums.length) return true;
    if (checksum != null && checksum === plannedChecksums[next]) next += 1;
  }
  return next === plannedChecksums.length;
}

export function galleryChecksumDrift(
  plannedChecksums: string[],
  observedChecksums: Array<string | null>,
) {
  if (plannedChecksums.length === 0) return false;
  if (observedChecksums.length < plannedChecksums.length) return true;
  const knownCount = observedChecksums.filter((checksum) => checksum != null).length;
  if (knownCount < plannedChecksums.length) return false;
  return !checksumsAreOrderedSubsequence(plannedChecksums, observedChecksums);
}

function observedSlideMatchesPlanned(
  plannedUrl: string,
  observedUrl: string | undefined,
  altUrl: string | null | undefined,
  canonicalize: (url: string) => string | null,
) {
  if (!observedUrl) return false;
  return (
    liveImagesEquivalent(plannedUrl, observedUrl, canonicalize) ||
    Boolean(altUrl && liveImagesEquivalent(plannedUrl, altUrl, canonicalize))
  );
}

export function plannedUrlsAreOrderedSubsequence(
  plannedUrls: string[],
  observedUrls: string[],
  canonicalize: (url: string) => string | null,
  observedAltUrls?: Array<string | null>,
) {
  if (plannedUrls.length === 0) return true;
  let next = 0;
  for (let index = 0; index < observedUrls.length; index += 1) {
    if (next >= plannedUrls.length) return true;
    if (
      observedSlideMatchesPlanned(
        plannedUrls[next]!,
        observedUrls[index],
        observedAltUrls?.[index] ?? null,
        canonicalize,
      )
    ) {
      next += 1;
    }
  }
  return next === plannedUrls.length;
}

export function galleryUrlOrderDrift(
  plannedUrls: string[],
  observedUrls: string[],
  canonicalize: (url: string) => string | null,
) {
  if (plannedUrls.length === 0) return false;
  if (observedUrls.length < plannedUrls.length) return true;
  return !plannedUrlsAreOrderedSubsequence(plannedUrls, observedUrls, canonicalize);
}

export function plannedGalleryAlignsWithLive(input: {
  plannedUrls: string[];
  observedUrls: string[];
  observedAltUrls?: Array<string | null>;
  plannedChecksums: string[];
  observedChecksums: Array<string | null>;
  canonicalize: (url: string) => string | null;
}) {
  if (input.plannedUrls.length === 0) return true;
  if (
    !observedSlideMatchesPlanned(
      input.plannedUrls[0]!,
      input.observedUrls[0],
      input.observedAltUrls?.[0] ?? null,
      input.canonicalize,
    )
  ) {
    return false;
  }
  if (input.observedUrls.length < input.plannedUrls.length) {
    let nextPlannedIndex = 1;
    for (let observedIndex = 1; observedIndex < input.observedUrls.length; observedIndex += 1) {
      const checksum = input.observedChecksums[observedIndex] ?? null;
      const matchedIndex = input.plannedUrls.findIndex((plannedUrl, plannedIndex) =>
        observedSlideMatchesPlanned(
          plannedUrl,
          input.observedUrls[observedIndex],
          input.observedAltUrls?.[observedIndex] ?? null,
          input.canonicalize,
        ) || Boolean(
          checksum &&
          input.plannedChecksums[plannedIndex] === checksum,
        ));
      if (matchedIndex < 0) continue;
      if (matchedIndex < nextPlannedIndex) return false;
      nextPlannedIndex = matchedIndex + 1;
    }
    return true;
  }
  if (
    plannedUrlsAreOrderedSubsequence(
      input.plannedUrls,
      input.observedUrls,
      input.canonicalize,
      input.observedAltUrls,
    )
  ) {
    return true;
  }
  return (
    input.plannedChecksums.length > 0 &&
    checksumsAreOrderedSubsequence(input.plannedChecksums, input.observedChecksums)
  );
}
