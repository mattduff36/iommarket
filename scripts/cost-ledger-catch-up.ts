import { pathToFileURL } from "node:url";

type RefreshStatus = "succeeded" | "partial" | "locked" | "skipped" | "failed";

interface RefreshResult {
  status: RefreshStatus;
  caughtUp?: boolean;
  classifiedCount?: number;
  quarantinedCount?: number;
  queryTo?: string;
  errorCode?: string;
  message?: string;
}

interface CatchUpOptions {
  origin: string;
  secret: string;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  onProgress?: (attempt: number, result: RefreshResult) => void;
}

export async function catchUpCostLedger({
  origin,
  secret,
  maxAttempts = 200,
  fetchImpl = fetch,
  wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onProgress,
}: CatchUpOptions): Promise<RefreshResult> {
  const endpoint = `${origin.replace(/\/+$/, "")}/api/internal/cost-ledger/refresh`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(190_000),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: RefreshResult;
      error?: string;
    } | null;
    const result = body?.data;

    if (!response.ok || !result) {
      throw new Error(
        body?.error || `Cost catch-up request failed with HTTP ${response.status}.`,
      );
    }
    onProgress?.(attempt, result);

    if (result.status === "succeeded" && result.caughtUp !== false) {
      return result;
    }
    if (result.status === "partial") continue;
    if (result.status === "succeeded" && result.caughtUp === false) continue;
    if (result.status === "locked") {
      await wait(10_000);
      continue;
    }

    throw new Error(
      result.message ||
        `Cost catch-up stopped with ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}.`,
    );
  }

  throw new Error(`Cost catch-up exceeded ${maxAttempts} requests.`);
}

async function main() {
  const origin = process.env.COST_LEDGER_ORIGIN?.trim();
  const secret = process.env.COST_LEDGER_REQUEST_SECRET?.trim();
  if (!origin || !secret) {
    throw new Error(
      "COST_LEDGER_ORIGIN and COST_LEDGER_REQUEST_SECRET must be configured.",
    );
  }

  const configuredLimit = Number.parseInt(
    process.env.COST_LEDGER_CATCH_UP_MAX_ATTEMPTS ?? "200",
    10,
  );
  const maxAttempts =
    Number.isFinite(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : 200;

  const result = await catchUpCostLedger({
    origin,
    secret,
    maxAttempts,
    onProgress(attempt, progress) {
      console.info(
        JSON.stringify({
          attempt,
          status: progress.status,
          classifiedCount: progress.classifiedCount ?? 0,
          quarantinedCount: progress.quarantinedCount ?? 0,
          caughtUp: progress.caughtUp ?? null,
          queryTo: progress.queryTo ?? null,
          errorCode: progress.errorCode ?? null,
        }),
      );
    },
  });

  console.info(
    `Cost ledger caught up${result.queryTo ? ` through ${result.queryTo}` : ""}.`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Cost catch-up failed.");
    process.exitCode = 1;
  });
}
