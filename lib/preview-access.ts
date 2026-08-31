export const PREVIEW_ACCESS_PATH = "/preview";

export type PreviewAccessResolution =
  | { action: "allow" }
  | { action: "redirect"; to: typeof PREVIEW_ACCESS_PATH };

export function resolvePreviewAccessPath(
  pathname: string,
): PreviewAccessResolution | null {
  if (pathname === PREVIEW_ACCESS_PATH) {
    return { action: "allow" };
  }

  if (pathname === "/dev" || pathname === "/dev/auth") {
    return { action: "redirect", to: PREVIEW_ACCESS_PATH };
  }

  return null;
}
