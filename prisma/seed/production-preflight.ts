import { assertProductionEnvMirrorCurrent } from "@/lib/ops/production-env";

export function runConfirmedProductionSeedPreflight(input?: {
  check?: () => void;
}): void {
  (input?.check ?? assertProductionEnvMirrorCurrent)();
}
