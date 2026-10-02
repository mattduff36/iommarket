import { PREVIEW_GATE_OPENS_AT } from "@/lib/launch/preview-rehearsal";

export const PREVIEW_WELCOME_WINDOW_MS = 2 * 60 * 60 * 1000;
export const PREVIEW_REVEAL_MS = 5200;

export function previewWelcomeEndsAt(opensAt = PREVIEW_GATE_OPENS_AT): number {
  return opensAt + PREVIEW_WELCOME_WINDOW_MS;
}

/** Host-only session cookie. The stamp is the launch instant, so a rehearsal cannot suppress the real launch. */
export function previewWelcomeCookieName(opensAt = PREVIEW_GATE_OPENS_AT): string {
  const stamp = new Date(opensAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `itrader_launch_seen_preview_${stamp}`;
}

export function shouldAnimateCountdownFlight(
  leftMs: number,
  wasAboveTen: boolean,
  reducedMotion: boolean,
): boolean {
  return wasAboveTen && leftMs <= 10000 && leftMs > 8000 && !reducedMotion;
}
