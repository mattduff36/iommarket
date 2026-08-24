import { timingSafeEqual } from "crypto";

export type DevAuthEnv = {
  devPass?: string;
  previewPass?: string;
  previewUrl?: string;
};

export type DevAuthDecision =
  | { kind: "not_configured" }
  | { kind: "dev" }
  | { kind: "preview"; redirect: string }
  | { kind: "unauthorized" };

export function passwordsMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function decideDevAuth(
  password: unknown,
  env: DevAuthEnv,
): DevAuthDecision {
  const { devPass, previewPass, previewUrl } = env;

  if (!devPass || typeof password !== "string") {
    return { kind: "not_configured" };
  }

  const isDev = passwordsMatch(password, devPass);
  const previewConfigured =
    typeof previewPass === "string" && previewPass.length > 0;
  const isPreviewPassword =
    previewConfigured && passwordsMatch(password, previewPass);
  const canRedirectPreview =
    typeof previewUrl === "string" && isHttpUrl(previewUrl);

  if (isDev) {
    return { kind: "dev" };
  }

  if (isPreviewPassword && canRedirectPreview) {
    return { kind: "preview", redirect: previewUrl };
  }

  return { kind: "unauthorized" };
}
