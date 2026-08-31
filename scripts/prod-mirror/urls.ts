import { DEALER_LOGO_BUCKET } from "../../lib/upload/dealer-logo";
import { PREVIEW_SUPABASE_HOST, PRODUCTION_SUPABASE_HOST } from "./constants";

const PUBLIC_PREFIX = `/storage/v1/object/public/${DEALER_LOGO_BUCKET}/`;

export function rewritePreviewUserAvatarsUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return raw ?? null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:") return raw;
    if (parsed.hostname.toLowerCase() !== PREVIEW_SUPABASE_HOST) return raw;
    const pathname = decodeURIComponent(parsed.pathname);
    if (!pathname.startsWith(PUBLIC_PREFIX)) return raw;
    parsed.hostname = PRODUCTION_SUPABASE_HOST;
    parsed.port = "";
    return parsed.toString();
  } catch {
    return raw;
  }
}

export function rewriteMediaUrlFields(input: {
  avatarUrl: string | null;
  logoUrl: string | null;
}) {
  return {
    avatarUrl: rewritePreviewUserAvatarsUrl(input.avatarUrl),
    logoUrl: rewritePreviewUserAvatarsUrl(input.logoUrl),
  };
}
