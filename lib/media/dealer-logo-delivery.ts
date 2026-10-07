import { readMediaProviderMode, isSampleDestinationPath } from "@/lib/media/config";
import { findMigratedDealerLogo } from "@/lib/media/migrated-dealer-logos";
import { signedImageKitDeliveryUrl } from "@/lib/media/imagekit-api";
import { imageKitDeliveryRelativePath } from "@/lib/media/imagekit-transforms";
import { isDatabaseSyncReference } from "@/lib/images/database-sync-reference";
import { signPrivateCloudinaryUrl } from "@/lib/upload/cloudinary";

function normalizedSource(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" ||
    url.username || url.password || url.port || url.search || (url.hash && !isDatabaseSyncReference(value))) {
    throw new Error("Dealer logo is not an approved migration source.");
  }
  url.hash = "";
  return url.toString();
}

export function isExactlyMappedDealerLogo(value: string) {
  try { return Boolean(findMigratedDealerLogo(normalizedSource(value))); }
  catch { return false; }
}

/** Call only after authorizing the dealer's stored logo. Never sign an arbitrary client path. */
export function dealerLogoDeliveryUrl(value: string, env: NodeJS.ProcessEnv = process.env) {
  const url = new URL(value);
  url.hash = "";
  const mode = readMediaProviderMode(env);
  if (url.hostname !== "res.cloudinary.com") return url.toString();
  if (mode === "cloudinary") {
    const cloudName = env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
    const privatePrefix = `/${cloudName}/image/private/`;
    if (!cloudName || !url.pathname.startsWith(privatePrefix)) {
      return url.toString();
    }
    if (url.search || !env.CLOUDINARY_API_SECRET) throw new Error("Private Cloudinary logo signing is unavailable.");
    return signPrivateCloudinaryUrl(url.toString(), env);
  }
  const asset = findMigratedDealerLogo(normalizedSource(value));
  if (mode === "imagekit-sample" && ((asset && !isSampleDestinationPath(asset.destinationPath)) || (!asset && env.MEDIA_IMAGEKIT_STRICT !== "1"))) return url.toString();
  if (!asset || asset.resourceType !== "image") throw new Error("Dealer logo is unmapped in strict ImageKit mode.");
  return signedImageKitDeliveryUrl({
    relativePath: imageKitDeliveryRelativePath(asset.destinationPath, "w-1000,h-380,c-at_max,f-png"), env,
  });
}
