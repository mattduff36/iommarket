import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(projectRoot, "node_modules", "maplibre-gl", "dist");
const destinationDirectory = join(projectRoot, "public", "vendor", "maplibre-gl");
const workerFiles = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

try {
  await mkdir(destinationDirectory, { recursive: true });
  await Promise.all(
    workerFiles.map((file) =>
      copyFile(join(sourceDirectory, file), join(destinationDirectory, file)),
    ),
  );
} catch (error) {
  throw new Error(
    "Could not prepare the MapLibre worker assets. Install dependencies before starting or building the app.",
    { cause: error },
  );
}
