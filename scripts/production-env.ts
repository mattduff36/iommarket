import {
  assertProductionEnvMirrorCurrent,
  pullProductionEnvMirror,
} from "@/lib/ops/production-env";
import { ProductionEnvError } from "@/lib/ops/production-env-file";

function main() {
  const command = process.argv[2];
  if (command === "pull") {
    pullProductionEnvMirror();
    console.log("Pulled the Vercel production environment into .env.production.");
    return;
  }
  if (command === "check") {
    assertProductionEnvMirrorCurrent();
    console.log(".env.production matches the Vercel production environment.");
    return;
  }
  throw new ProductionEnvError("Usage: production-env.ts <pull|check>");
}

try {
  main();
} catch (error) {
  const message =
    error instanceof ProductionEnvError
      ? error.message
      : "Production environment command failed.";
  console.error(message);
  process.exitCode = 1;
}
