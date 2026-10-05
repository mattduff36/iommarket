import { readMediaProviderMode } from "@/lib/media/config";

/** Writes and delivery have separate preferences so a read rollback can keep native ImageKit uploads. */
export function readMediaUploadProvider(env: Record<string, string | undefined> = process.env): "cloudinary" | "imagekit" {
  const configured = env.MEDIA_PROVIDER?.trim();
  if (configured && !["cloudinary", "imagekit", "imagekit-sample"].includes(configured)) throw new Error("The media delivery provider is invalid.");
  const delivery = readMediaProviderMode(env);
  const explicit = env.MEDIA_UPLOAD_PROVIDER?.trim();
  if (explicit && explicit !== "cloudinary" && explicit !== "imagekit") {
    throw new Error("The media upload provider is invalid.");
  }
  if (delivery === "imagekit" && explicit === "cloudinary") {
    throw new Error("Strict ImageKit delivery cannot accept unmapped Cloudinary uploads.");
  }
  if (explicit === "cloudinary" || explicit === "imagekit") return explicit;
  if (delivery === "imagekit-sample") throw new Error("Sample delivery does not enable listing uploads.");
  return delivery;
}
