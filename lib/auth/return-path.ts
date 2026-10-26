const LOCAL_ORIGIN = "https://return-path.invalid";

function decodeReturnPath(value: string): string | null {
  let candidate = value;
  for (let pass = 0; pass < 3; pass += 1) {
    if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return null;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return candidate;
      candidate = decoded;
    } catch {
      return null;
    }
  }
  return /[\u0000-\u001f\u007f\\]/.test(candidate) ? null : candidate;
}

/** Local same-origin path only. Rejects external, protocol-relative, backslash, control, and encoded variants. */
export function getSafeNextPath(nextPath: string | null | undefined): string | null {
  if (!nextPath) return null;
  const original = nextPath.trim();
  if (!original.startsWith("/") || original.startsWith("//")) return null;
  const decoded = decodeReturnPath(original);
  if (!decoded || !decoded.startsWith("/") || decoded.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(decoded, LOCAL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== LOCAL_ORIGIN || url.username || url.password) return null;
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(url.pathname) || url.pathname.includes("://")) return null;
  // Decode only to validate. Preserve encoded query values such as %26 or %23.
  const originalUrl = new URL(original, LOCAL_ORIGIN);
  if (originalUrl.origin !== LOCAL_ORIGIN) return null;
  return `${originalUrl.pathname}${originalUrl.search}${originalUrl.hash}`;
}
