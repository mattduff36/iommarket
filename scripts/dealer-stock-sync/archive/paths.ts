import { resolve } from "path";

export function archiveRoot(override?: string) {
  return resolve(override ?? process.env.DEALER_STOCK_ARCHIVE_DIR ?? "private/dealer-stock-archive");
}

export function runDir(root: string, runId: string) {
  return resolve(root, "runs", runId);
}

export function dealerDir(root: string, runId: string, dealerKey: string) {
  return resolve(runDir(root, runId), dealerKey);
}

export function createRunId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}
