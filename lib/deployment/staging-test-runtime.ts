import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

export class StagingIdentityError extends Error {
  constructor() {
    super("Staging service effects are blocked because the deployment identity is not verified.");
    this.name = "StagingIdentityError";
  }
}

/** Invalid preview configuration must never fall through to a live service. */
export function isStagingTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isStagingOnlyFeatureEnabled(env)) return true;
  if (env.ITRADER_DEPLOYMENT_ROLE === "staging" || env.VERCEL_ENV === "preview") {
    throw new StagingIdentityError();
  }
  return false;
}
