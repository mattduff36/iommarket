/**
 * Maintenance backup producer for dealer-pack recovery manifests.
 * Workstream: prod-mirror-20260831
 *
 * Only `backup` remains. Restore, storage copy, waitlist copy, URL rewrite
 * and verify were removed because they targeted production.
 *
 * npx tsx scripts/prod-mirror.ts backup --target=preview --allow=1 --source-ref=... --dest-ref=...
 */
import { runBackup } from "./prod-mirror/backup";
import { parseCommand } from "./prod-mirror/safety";

async function main() {
  const argv = process.argv.slice(2);
  const command = parseCommand(argv);
  if (command !== "backup") {
    throw new Error("That prod-mirror command has been removed. Only backup remains.");
  }
  await runBackup(argv);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
