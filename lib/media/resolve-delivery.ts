import {
  imageKitModeIsStrict,
  isDisposableDestinationPath,
  isProtectedDestinationPath,
  readMediaProviderMode,
  type MediaProviderMode,
} from "@/lib/media/config";
import { referenceUsesSample, type ReferenceMatch } from "@/lib/media/match-reference";

export type DeliveryDecision = "cloudinary" | "imagekit" | "unresolved" | "passthrough";

export function decideReferenceDelivery(input: {
  match: ReferenceMatch;
  mode?: MediaProviderMode;
  env?: NodeJS.ProcessEnv;
  disposablePath?: string | null;
}): { decision: DeliveryDecision; reason: string } {
  const mode = input.mode ?? readMediaProviderMode(input.env);
  if (input.disposablePath) {
    if (!isDisposableDestinationPath(input.disposablePath) || isProtectedDestinationPath(input.disposablePath)) {
      return { decision: "unresolved", reason: "Disposable media path failed its guard." };
    }
    if (mode !== "imagekit") {
      return { decision: "unresolved", reason: "ImageKit development uploads are only delivered in strict ImageKit mode." };
    }
    return { decision: "imagekit", reason: "Development upload is restricted to the disposable folder." };
  }

  if (input.match.kind === "not-cloudinary") {
    return { decision: "passthrough", reason: input.match.reason };
  }
  if (mode === "cloudinary") {
    return { decision: "cloudinary", reason: "Cloudinary remains the selected provider." };
  }

  const matched = input.match.kind === "exact-asset-id" || input.match.kind === "exact-public-id-version";
  if (matched && input.match.asset) {
    if (mode === "imagekit" || referenceUsesSample(input.match)) {
      return { decision: "imagekit", reason: "Reference resolved to one migrated ImageKit original." };
    }
    return { decision: "cloudinary", reason: "Sample mode leaves non-sample originals on Cloudinary." };
  }

  if (mode === "imagekit" || imageKitModeIsStrict(mode, input.env)) {
    return { decision: "unresolved", reason: input.match.reason };
  }
  return { decision: "cloudinary", reason: "Sample mode keeps an unresolved non-sample reference on Cloudinary." };
}
