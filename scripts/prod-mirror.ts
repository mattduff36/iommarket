/**
 * Preview → production database mirror.
 * Workstream: prod-mirror-20260831
 *
 * Confirmations are CLI flags only. Env files may supply connection strings.
 * Dumps are written to gitignored .local/db-backups/.
 *
 * npx tsx scripts/prod-mirror.ts backup --target=preview --allow=1 --source-ref=... --dest-ref=...
 * npx tsx scripts/prod-mirror.ts copy-waitlist --allow=1 --writers-paused=1 --backup-id=... --confirm-db=...
 * npx tsx scripts/prod-mirror.ts copy-storage ...
 * npx tsx scripts/prod-mirror.ts restore --source-backup-id=... --backup-id=...
 * npx tsx scripts/prod-mirror.ts rewrite-urls ...
 * npx tsx scripts/prod-mirror.ts verify --allow=1 --source-ref=... --dest-ref=...
 */
import { runBackup } from "./prod-mirror/backup";
import { runCopyStorage } from "./prod-mirror/copy-storage";
import { runCopyWaitlist } from "./prod-mirror/copy-waitlist";
import { runRestore } from "./prod-mirror/restore";
import { runRewriteMediaUrls } from "./prod-mirror/rewrite-media-urls";
import { parseCommand } from "./prod-mirror/safety";
import { runVerify } from "./prod-mirror/verify";

async function main() {
  const argv = process.argv.slice(2);
  const command = parseCommand(argv);
  switch (command) {
    case "backup":
      await runBackup(argv);
      return;
    case "copy-waitlist":
      await runCopyWaitlist(argv);
      return;
    case "copy-storage":
      await runCopyStorage(argv);
      return;
    case "restore":
      await runRestore(argv);
      return;
    case "rewrite-urls":
      await runRewriteMediaUrls(argv);
      return;
    case "verify":
      await runVerify(argv);
      return;
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported command: ${String(exhaustive)}`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
