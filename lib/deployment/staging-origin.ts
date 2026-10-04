export const STAGING_ORIGIN = "https://itrader.dev";

/** Exact staging app origin. A path, query, hash, or credential is not staging. */
export function isStagingAppOrigin(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.origin === STAGING_ORIGIN &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "";
  } catch {
    return false;
  }
}
