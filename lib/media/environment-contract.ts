import { readMediaUploadProvider } from "@/lib/media/upload-provider";

export interface MediaEnvironmentIssue { key: string; code: "missing" | "invalid" }
const MODES = ["cloudinary", "imagekit-sample", "imagekit"];
const EXPECTED_ENDPOINT = "https://ik.imagekit.io/itraderim";
const EXPECTED_CLOUD = "du3othqre";

/** Deployment validation is provider-aware. It never changes the environment. */
export function mediaEnvironmentIssues(env: Record<string, string | undefined>): MediaEnvironmentIssue[] {
  const issues: MediaEnvironmentIssue[] = [];
  const present = (key: string) => env[key]?.trim() || null;
  const requireValue = (key: string, valid?: (value: string) => boolean) => {
    const value = present(key);
    if (!value) issues.push({ key, code: "missing" });
    else if (valid && !valid(value)) issues.push({ key, code: "invalid" });
  };
  const read = present("MEDIA_PROVIDER") ?? "cloudinary";
  if (!MODES.includes(read)) issues.push({ key: "MEDIA_PROVIDER", code: "invalid" });
  const publicMode = present("NEXT_PUBLIC_MEDIA_PROVIDER") ?? "cloudinary";
  if (publicMode !== read) issues.push({ key: "NEXT_PUBLIC_MEDIA_PROVIDER", code: "invalid" });
  let upload: "imagekit" | "cloudinary" = "cloudinary";
  try { upload = readMediaUploadProvider(env); }
  catch { issues.push({ key: "MEDIA_UPLOAD_PROVIDER", code: "invalid" }); }
  const needsCloudinary = read !== "imagekit" || upload === "cloudinary";
  const needsImageKit = read !== "cloudinary" || upload === "imagekit" || env.IMAGEKIT_UPLOADS_ENABLED === "1";
  if (needsCloudinary) {
    requireValue("CLOUDINARY_API_KEY");
    requireValue("CLOUDINARY_API_SECRET", value => value.length >= 32);
    requireValue("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", value => value === EXPECTED_CLOUD);
  }
  if (needsImageKit) {
    requireValue("IMAGEKIT_PRIVATE_KEY", value => value.startsWith("private_") && value.length >= 32);
    requireValue("IMAGEKIT_URL_ENDPOINT", value => value === EXPECTED_ENDPOINT);
  }
  if (upload === "imagekit") {
    requireValue("IMAGEKIT_PUBLIC_KEY", value => value.startsWith("public_"));
    if (env.IMAGEKIT_UPLOADS_ENABLED !== "1") issues.push({ key: "IMAGEKIT_UPLOADS_ENABLED", code: "invalid" });
  }
  if (env.VERCEL_ENV === "production") {
    if (env.IMAGEKIT_DEV_UPLOADS === "1") issues.push({ key: "IMAGEKIT_DEV_UPLOADS", code: "invalid" });
    if (read === "imagekit-sample") issues.push({ key: "MEDIA_PROVIDER", code: "invalid" });
  }
  return issues;
}
