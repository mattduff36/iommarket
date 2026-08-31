import { writeFileSync } from "node:fs";
import { loadMirrorEnvs, productionCandidates } from "./cli-env";
import { createReadPool, listAuthEmails, snapshotWaitlist } from "./db";
import { chooseRestoreConnectionString } from "./target";

async function main() {
  const envs = loadMirrorEnvs(process.argv.slice(2));
  const pool = createReadPool(chooseRestoreConnectionString(productionCandidates(envs.production)));
  try {
    const [auth, waitlist] = await Promise.all([listAuthEmails(pool), snapshotWaitlist(pool)]);
    const payload = {
      auth: auth.length,
      waitlist: waitlist.length,
      authSample: auth.slice(0, 8),
    };
    writeFileSync(".local/pmr-prod-state.json", `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`auth=${payload.auth} waitlist=${payload.waitlist}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
