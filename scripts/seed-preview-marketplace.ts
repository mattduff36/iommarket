/**
 * Preview rebuild entry used by `npm run db:seed:preview`.
 * Workstream: PREVIEW-SAMPLE-A7C3E91F
 *
 * Prints the confirmation card by default. Does not mutate without --confirm.
 */
import { main } from "./preview-rebuild";

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Preview seed failed."}\n`);
  process.exitCode = 1;
});
