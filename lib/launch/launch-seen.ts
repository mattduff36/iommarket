import { previewWelcomeCookieName } from "@/lib/launch/preview-welcome";

const memorySeen = new Set<string>();

function readCookie(name: string): string {
  try {
    const row = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
    return row ? decodeURIComponent(row.slice(name.length + 1)) : "";
  } catch {
    return "";
  }
}

export function hasSeenLaunch(opensAt: number, environment = "public"): boolean {
  const name = previewWelcomeCookieName(opensAt, environment);
  if (memorySeen.has(name)) return true;
  if (typeof document === "undefined") return false;
  if (readCookie(name) === "1") return true;
  try {
    return window.sessionStorage.getItem(name) === "1";
  } catch {
    return false;
  }
}

export function markSeenLaunch(opensAt: number, environment = "public"): void {
  const name = previewWelcomeCookieName(opensAt, environment);
  memorySeen.add(name);
  try {
    document.cookie = `${name}=1; Path=/; SameSite=Lax`;
  } catch {
    // A blocked cookie must not trap the visitor on the animation.
  }
  try {
    window.sessionStorage.setItem(name, "1");
  } catch {
    // The in-memory guard still stops a second start on this page.
  }
}
