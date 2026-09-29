import { readFileSync } from "node:fs";
import {
  normalizeImageFormat,
  validateListingImageBounds,
} from "../../lib/images/constraints";

export interface FrozenImageMetadata {
  width: number;
  height: number;
  format: string;
  bytes: number;
}

function jpegDimensions(bytes: Buffer) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    const length = bytes.readUInt16BE(offset + 2);
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Buffer) {
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (kind === "VP8 " && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (kind === "VP8L" && bytes.length >= 25) {
    const packed = bytes.readUInt32LE(21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function inspectFrozenImage(bytes: Buffer): FrozenImageMetadata | null {
  let dimensions: { width: number; height: number } | null = null;
  let format: string | null = null;
  if (bytes.length >= 24 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a") {
    format = "png";
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = "jpg";
    dimensions = jpegDimensions(bytes);
  } else if (
    bytes.length >= 16 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    format = "webp";
    dimensions = webpDimensions(bytes);
  }
  if (!format || !dimensions) return null;
  return { ...dimensions, format: normalizeImageFormat(format) ?? format, bytes: bytes.length };
}

export function inspectFrozenImageFile(path: string) {
  return inspectFrozenImage(readFileSync(path));
}

export function frozenImageQualityError(metadata: FrozenImageMetadata | null) {
  if (!metadata) return "unsupported-or-unreadable-image";
  return validateListingImageBounds(metadata);
}
