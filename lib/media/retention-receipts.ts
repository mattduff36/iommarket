import { readMediaProviderMode } from "@/lib/media/config";
import { cloudinaryIdentityFromUrl } from "@/lib/media/match-reference";
import { findMigratedDealerLogo } from "@/lib/media/migrated-dealer-logos";
import { isDatabaseSyncReference } from "@/lib/images/database-sync-reference";

export const MEDIA_RETENTION_HOLD = "media-retention-hold";

/** Preserve both identities before removing a profile reference. Never authorizes deletion. */
export function legacyProfileRetentionReceipt(url: string | null | undefined) {
  if (!url || isDatabaseSyncReference(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com" ||
    parsed.pathname.split("/")[1] !== "du3othqre") return null;
  const mapped = findMigratedDealerLogo(parsed.toString());
  if (!mapped && readMediaProviderMode() === "cloudinary") return null;
  const source = cloudinaryIdentityFromUrl(url);
  if (!source) throw new Error("The profile image needs a verified retention record before deletion.");
  return {
    publicId: source.publicId, deliveryType: MEDIA_RETENTION_HOLD,
    imageKitFilePath: mapped?.destinationPath ?? null,
    reason: mapped ? "profile-migrated-retention" : "profile-cloudinary-retention",
  };
}
