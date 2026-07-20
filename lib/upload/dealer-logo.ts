export const DEALER_LOGO_BUCKET = "user-avatars";
export const DEALER_LOGO_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_LOGO_TYPES = {
  "image/gif": ["gif"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
} as const;

export interface ValidatedDealerLogo {
  bytes: Uint8Array;
  extension: "gif" | "jpg" | "jpeg" | "png" | "webp";
  mimeType: keyof typeof ALLOWED_LOGO_TYPES;
}

interface OwnedDealerLogoParams {
  logoUrl: string | null;
  supabaseUrl: string;
  authUserId: string;
  dealerId: string;
}

interface StorageFile {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

export async function validateDealerLogoFile(
  file: StorageFile,
): Promise<{ data: ValidatedDealerLogo } | { error: string }> {
  const extension = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase() as keyof typeof ALLOWED_LOGO_TYPES;

  if (!extension || !isAllowedLogoType(mimeType, extension)) {
    return { error: "Upload a PNG, JPG, GIF, or WebP image." };
  }

  if (file.size <= 0) return { error: "Choose an image file to upload." };
  if (file.size > DEALER_LOGO_MAX_FILE_SIZE_BYTES) {
    return { error: "Logo images must be 5 MB or smaller." };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { error: "Could not read the selected image. Please try another file." };
  }
  if (!hasExpectedFileSignature(bytes, mimeType)) {
    return { error: "The selected file does not match its image type." };
  }

  return {
    data: {
      bytes,
      extension,
      mimeType,
    },
  };
}

export function createDealerLogoStoragePath({
  authUserId,
  dealerId,
  extension,
  objectId,
}: {
  authUserId: string;
  dealerId: string;
  extension: ValidatedDealerLogo["extension"];
  objectId: string;
}) {
  const ownerSegment = sanitizeStorageSegment(authUserId);
  const dealerSegment = sanitizeStorageSegment(dealerId);
  const objectSegment = sanitizeStorageSegment(objectId);

  return `${ownerSegment}/dealer-logos/${dealerSegment}/${objectSegment}.${extension}`;
}

export function getOwnedDealerLogoStoragePath({
  logoUrl,
  supabaseUrl,
  authUserId,
  dealerId,
}: OwnedDealerLogoParams): string | null {
  if (!logoUrl || !supabaseUrl) return null;

  try {
    const parsedLogoUrl = new URL(logoUrl);
    const parsedSupabaseUrl = new URL(supabaseUrl);
    if (parsedLogoUrl.origin !== parsedSupabaseUrl.origin) return null;

    const prefix = `/storage/v1/object/public/${DEALER_LOGO_BUCKET}/`;
    const pathname = decodeURIComponent(parsedLogoUrl.pathname);
    if (!pathname.startsWith(prefix)) return null;

    const path = pathname.slice(prefix.length);
    const expectedPrefix = `${sanitizeStorageSegment(authUserId)}/dealer-logos/${sanitizeStorageSegment(dealerId)}/`;
    const fileName = path.slice(expectedPrefix.length);

    if (!path.startsWith(expectedPrefix) || !isDealerLogoFileName(fileName)) return null;
    return path;
  } catch {
    return null;
  }
}

function getFileExtension(fileName: string): ValidatedDealerLogo["extension"] | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !["gif", "jpg", "jpeg", "png", "webp"].includes(extension)) {
    return null;
  }
  return extension as ValidatedDealerLogo["extension"];
}

function isAllowedLogoType(
  mimeType: keyof typeof ALLOWED_LOGO_TYPES,
  extension: ValidatedDealerLogo["extension"],
) {
  return ALLOWED_LOGO_TYPES[mimeType]?.includes(extension as never) ?? false;
}

function hasExpectedFileSignature(
  bytes: Uint8Array,
  mimeType: keyof typeof ALLOWED_LOGO_TYPES,
) {
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (mimeType === "image/gif") {
    const signature = new TextDecoder().decode(bytes.slice(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  }

  return (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  );
}

function sanitizeStorageSegment(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!sanitized) throw new Error("Invalid storage path segment");
  return sanitized;
}

function isDealerLogoFileName(value: string) {
  return /^[a-zA-Z0-9_-]+\.(gif|jpg|jpeg|png|webp)$/.test(value);
}
