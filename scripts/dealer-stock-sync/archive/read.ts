import { readFile } from "fs/promises";
import { join } from "path";
import type { ArchivedVehicle } from "../types";
import { archiveRoot, dealerDir } from "./paths";

export async function readDealerSnapshot(input: {
  dealerKey: string;
  runId: string;
  root?: string;
}) {
  const dir = dealerDir(archiveRoot(input.root), input.runId, input.dealerKey);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
    dealerKey: string;
    displayName: string;
    uniqueVehicles: number;
    importable: number;
  };
  const vehicles = JSON.parse(await readFile(join(dir, "vehicles.json"), "utf8")) as ArchivedVehicle[];
  return { dir, manifest, vehicles };
}
