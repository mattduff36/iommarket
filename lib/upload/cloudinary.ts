/**
 * Cloudinary upload configuration and helpers.
 *
 * Client-side uploads use the CldUploadWidget from next-cloudinary.
 * This module provides server-side helpers for deletion and configuration.
 */

export function getCloudinaryConfig() {
  return {
    cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  };
}

/**
 * Delete an image from Cloudinary by public ID.
 */
export async function deleteImage(publicId: string): Promise<void> {
  const config = getCloudinaryConfig();
  const timestamp = Math.round(Date.now() / 1000);

  // Build signature string (requires crypto on server)
  const { createHash } = await import("node:crypto");
  const signatureString = `public_id=${publicId}&timestamp=${timestamp}${config.apiSecret}`;
  const signature = createHash("sha1").update(signatureString).digest("hex");

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        public_id: publicId,
        timestamp: String(timestamp),
        api_key: config.apiKey,
        signature,
      }).toString(),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete image: ${response.statusText}`);
  }
}

/**
 * Max image dimensions and file size for listing photos.
 */
export const IMAGE_CONSTRAINTS = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  maxWidth: 2400,
  maxHeight: 2400,
  allowedFormats: ["jpg", "jpeg", "png", "webp"],
  folder: "iommarket/listings",
} as const;
