/**
 * Preview wipe CLI is disabled for PREVIEW-SAMPLE-A7C3E91F.
 * Use the confirmation-gated runner: npm run db:rebuild:preview
 */
async function main() {
  throw new Error(
    "Direct preview wipe is disabled for PREVIEW-SAMPLE-A7C3E91F. Use npm run db:rebuild:preview.",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
