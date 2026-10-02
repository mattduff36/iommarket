/**
 * Check whether an independent Vercel error alert is attested or visible.
 * This does not create or modify Vercel resources.
 *
 * Usage: npx tsx scripts/monitoring/configure-vercel-alerts.ts
 */
import { checkVercelErrorAlerts } from "@/lib/monitoring/vercel-fallback";

async function main() {
  const status = await checkVercelErrorAlerts();
  console.log(JSON.stringify({
    status,
    setup: [
      "Open the iommarket project in Vercel.",
      "Create a production error-anomaly or runtime error alert.",
      "Send it to an inbox that does not depend on the app database.",
      "Set VERCEL_OBSERVABILITY_ALERTS_CONFIGURED=1 after the alert exists.",
    ],
  }, null, 2));
  if (status === "missing") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
