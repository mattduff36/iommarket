import { MEDIA_PROVIDER_MODES, type MediaProviderMode } from "@/lib/media/config";

const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/itraderim";

export function assertPairedMediaProvider(env: Record<string, string | undefined> = process.env) {
  const server = normalise(env.MEDIA_PROVIDER);
  const client = normalise(env.NEXT_PUBLIC_MEDIA_PROVIDER);
  if (server !== client) {
    throw new Error("Server and public media provider settings do not match.");
  }
  if (server === "imagekit" || server === "imagekit-sample") {
    if (env.IMAGEKIT_URL_ENDPOINT !== IMAGEKIT_ENDPOINT || !env.IMAGEKIT_PRIVATE_KEY) {
      throw new Error("ImageKit delivery is not configured for the verified account.");
    }
  }
  return server;
}

function normalise(value: string | undefined): MediaProviderMode {
  const requested = value?.trim();
  if (MEDIA_PROVIDER_MODES.includes(requested as MediaProviderMode)) {
    return requested as MediaProviderMode;
  }
  return "cloudinary";
}
