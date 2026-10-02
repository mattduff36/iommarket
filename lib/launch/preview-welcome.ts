import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";

export const PREVIEW_WELCOME_WINDOW_MS = 2 * 60 * 60 * 1000;
export const PREVIEW_REVEAL_MS = 5200;

export function previewWelcomeEndsAt(opensAt = PUBLIC_LAUNCH_AT): number {
  return opensAt + PREVIEW_WELCOME_WINDOW_MS;
}

/** Host-only session cookie. The environment and launch instant keep a rehearsal from suppressing the real launch. */
export function previewWelcomeCookieName(opensAt = PUBLIC_LAUNCH_AT, environment = "public"): string {
  const stamp = new Date(opensAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `itrader_launch_seen_${environment}_${stamp}`;
}

export function shouldAnimateCountdownFlight(
  leftMs: number,
  wasAboveTen: boolean,
  reducedMotion: boolean,
): boolean {
  return wasAboveTen && leftMs <= 10000 && leftMs > 8000 && !reducedMotion;
}
