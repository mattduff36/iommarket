import { createHash } from "node:crypto";

const EXPIRING_URL_PARAMS = new Set([
  "x-amz-algorithm", "x-amz-credential", "x-amz-date", "x-amz-expires", "x-amz-signedheaders", "x-amz-signature", "x-amz-security-token",
  "x-goog-algorithm", "x-goog-credential", "x-goog-date", "x-goog-expires", "x-goog-signedheaders", "x-goog-signature",
  "expires", "signature", "key-pair-id", "awsaccesskeyid", "googleaccessid",
]);

/** Keep image identity, transformations and content versions; remove only known signing parameters. */
export function stableStockSourceUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (EXPIRING_URL_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return value;
  }
}

export function sortedStockSet(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function stableStockContentSignature(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
