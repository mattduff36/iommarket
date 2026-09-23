import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";

export class OnboardingOriginError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OnboardingOriginError";
  }
}

export interface OnboardingOriginEnv {
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  NODE_ENV?: string;
}

function assertOriginOnly(url: URL, source: string) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OnboardingOriginError(`${source} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new OnboardingOriginError(`${source} must not include credentials.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new OnboardingOriginError(`${source} must not include a path, query, or hash.`);
  }
}

function previewDeploymentOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new OnboardingOriginError("Preview onboarding origin is not configured.");
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new OnboardingOriginError("Preview onboarding origin is not a valid URL.", {
      cause: error,
    });
  }
  assertOriginOnly(url, "Preview onboarding origin");
  if (url.protocol !== "https:") {
    throw new OnboardingOriginError("Preview onboarding origin must use https.");
  }
  return url;
}

export function resolveOnboardingOrigin(env: OnboardingOriginEnv = process.env) {
  if (env.VERCEL_ENV === "preview") {
    // VERCEL_URL identifies this deployment. VERCEL_BRANCH_URL can move to a
    // later deployment and would break the claim cookie, so it is not used.
    const deploymentUrl = env.VERCEL_URL?.trim();
    if (!deploymentUrl) {
      throw new OnboardingOriginError("Preview onboarding origin is not configured.");
    }
    return previewDeploymentOrigin(deploymentUrl);
  }

  return getCanonicalBaseUrl(
    env.NEXT_PUBLIC_APP_URL,
    nodeEnvironment(env.NODE_ENV),
    env.VERCEL_PROJECT_PRODUCTION_URL,
  );
}

function nodeEnvironment(
  value: string | undefined,
): "development" | "production" | "test" | undefined {
  if (value === "development" || value === "production" || value === "test") return value;
  return undefined;
}
