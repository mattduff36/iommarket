import { assessCandidate, buildProjectIndex, type ProjectIndex } from "./ast-assess";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CandidateRow {
  file: string;
  line: number;
  source: string;
}

export interface InventoryRecord {
  file: string;
  line: number;
  source: string;
  rule_id: string;
  classification: "displayed" | "internal-only" | "duplicate" | "irrelevant";
  /** Static producer-to-sink mapping only. This is not a runtime or browser proof. */
  semantic_display_verified: boolean;
  syntactic_evidence: string;
  journey: string;
  journey_evidence: string;
  reason: string;
  recovery: string;
  severity: "low" | "medium" | "high" | "unknown";
  severity_basis: string;
  implementation_status: string;
  test_evidence: string;
  exception: string;
  family_id: string;
  trace: string;
  group_id: string;
  duplicate_of: string;
}

const IMPORT_RE = /from\s+["']@\/([^"']+)["']/g;

export function parseCandidateCsv(text: string): CandidateRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.slice(1).filter((cells) => cells[0] && cells[1]).map((cells) => ({
    file: cells[0] ?? "",
    line: Number(cells[1]),
    source: cells[2] ?? "",
  }));
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "private") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
}

/** Co-occurrence only: a UI file imports the module and calls splitActionError. */
export function loadConsumerIndex(root: string): Map<string, string[]> {
  const files: string[] = [];
  for (const folder of ["app", "components"]) {
    const dir = join(root, folder);
    try {
      if (statSync(dir).isDirectory()) walk(dir, files);
    } catch {
      // The folder is optional for fixture runs.
    }
  }
  const consumers = new Map<string, string[]>();
  for (const full of files.sort()) {
    const text = readFileSync(full, "utf8");
    if (!text.includes("splitActionError")) continue;
    const rel = relative(root, full).replaceAll("\\", "/");
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? "";
      for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const key = `${spec}${suffix}`;
        const current = consumers.get(key) ?? [];
        if (!current.includes(rel)) current.push(rel);
        consumers.set(key, current);
      }
    }
  }
  return consumers;
}

function implementationStatus(file: string, owner = ""): string {
  if (file === "actions/listings.ts" && /withdraw|renewListing|reportListing|contactSeller|markListingAsSold/.test(owner)) return "deferred-c";
  if (/^app\/api\/listing-images\/|^components\/marketplace\/image-upload\.tsx$|^lib\/images\/(client-upload|imagekit-client-upload|upload-client-error)\.ts$|^lib\/media\/(verification-error|upload-error-catalog)\.ts$|^lib\/forms\/(action-error|public-error)\.ts$|^lib\/rate-limit-result\.ts$/.test(file)) {
    return "uploads-b-public-boundary";
  }
  if (/^lib\/(media\/(managed-upload|managed-io|strip-metadata)|listings\/photo-upload|images\/constraints)\.ts$/.test(file)) {
    return "uploads-b-mapped-if-surfaced";
  }
  if (/^actions\/listings\.ts$|^lib\/listings\/(save-public-error|sync-images-action)\.ts$|^app\/\(public\)\/sell\/|^create-listing/.test(file)) {
    return "listings-b-public-boundary";
  }
  if (/^actions\/(payments|sample-payments|hosted-payment-return)\.ts$|^lib\/payments\/checkout-public-error\.ts$|^app\/\(public\)\/payment-return\/|^app\/sample-checkout\/|^components\/payments\/(hosted-payment-return|payment-return-actions)\.tsx$/.test(file)) {
    return "payments-b-public-boundary";
  }
  if (file === "components/marketplace/featured-upgrade-button.tsx" || file === "app/(public)/dealer/subscribe/subscribe-form.tsx") return "payments-b-public-boundary";
  if (/payment|checkout|subscribe/.test(file)) return "deferred-c-payment-internals";
  if (/actions\/listings|\/sell\/|create-listing|listing-wizard/.test(file)) return "deferred-b-listings";
  if (/error\.tsx|global-error|error-fallback/.test(file)) return "deferred-d";
  return "deferred-c";
}

function testEvidence(status: string): string {
  if (status.startsWith("uploads-b")) {
    return "targeted contract and upload tests in this change; static trace is not per-line runtime proof";
  }
  if (status === "listings-b-public-boundary") {
    return "targeted listing save, wizard, and photo-conflict tests; static trace is not per-line runtime proof";
  }
  if (status === "payments-b-public-boundary") {
    return "targeted checkout public-error tests; static trace is not per-line runtime proof";
  }
  return "none in this batch";
}

function applyAssessment(row: CandidateRow, index: ProjectIndex | null): Omit<InventoryRecord, "group_id" | "duplicate_of"> {
  const assessed = assessCandidate(row, index);
  const status = implementationStatus(row.file, assessed.journey_evidence);
  const authException = /Not authorized/.test(row.source) ? "deliberate-generic-auth" : "";
  const enumeration = /publicAuthErrorMessage|Invalid login|invalid credentials/.test(row.source) ? "non-enumeration-review-deferred" : "";
  const exception = [assessed.exception, authException, enumeration].filter(Boolean).join("; ");
  return {
    file: row.file,
    line: row.line,
    source: row.source,
    ...assessed,
    exception,
    implementation_status: status,
    test_evidence: testEvidence(status),
  };
}

/** Snippet classification used by focused tests. Pass a project index from classifyCandidates for file context. */
export function classifyCandidate(row: CandidateRow, _consumers: readonly string[] = []): Omit<InventoryRecord, "group_id" | "duplicate_of"> {
  return applyAssessment(row, null);
}

export function classifyCandidates(rows: CandidateRow[], rootOrConsumers: string | Map<string, string[]>): InventoryRecord[] {
  const index = typeof rootOrConsumers === "string" ? buildProjectIndex(rootOrConsumers) : null;
  const seen = new Map<string, string>();
  return rows.map((row) => {
    const classified = applyAssessment(row, index);
    const key = classified.source.trim();
    const prior = key.length >= 24 ? seen.get(key) : undefined;
    if (!prior) {
      if (key.length >= 24) seen.set(key, `${row.file}:${row.line}`);
      return {
        ...classified,
        duplicate_of: "",
        group_id: `${classified.classification}:${classified.rule_id}:${classified.implementation_status}:${classified.family_id}`,
      };
    }
    return {
      ...classified,
      classification: "duplicate" as const,
      rule_id: "exact-source-repeat",
      duplicate_of: prior,
      semantic_display_verified: false,
      syntactic_evidence: `exact source repeat of ${prior}; underlying rule ${classified.rule_id}`,
      reason: "Same source text already classified earlier in the register.",
      group_id: `duplicate:exact-source-repeat:${classified.implementation_status}:${classified.family_id}`,
    };
  });
}

export function parseProvenance(text: string): CandidateRow[] {
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) => {
    const record = JSON.parse(line) as CandidateRow;
    return { file: record.file, line: Number(record.line), source: record.source };
  });
}

export function summariseInventory(records: InventoryRecord[], csvSha256: string) {
  const count = (key: keyof InventoryRecord) => {
    const totals: Record<string, number> = {};
    for (const record of records) {
      const value = String(record[key] || "(blank)");
      totals[value] = (totals[value] ?? 0) + 1;
    }
    return totals;
  };
  const groups = new Map<string, { id: string; count: number; example: string; rule_id: string; classification: string }>();
  for (const record of records) {
    const current = groups.get(record.group_id) ?? {
      id: record.group_id,
      count: 0,
      example: `${record.file}:${record.line}`,
      rule_id: record.rule_id,
      classification: record.classification,
    };
    current.count += 1;
    groups.set(record.group_id, current);
  }
  return {
    candidate_count: records.length,
    file_count: new Set(records.map((record) => record.file)).size,
    csv_sha256: csvSha256,
    semantic_display_verified_count: records.filter((record) => record.semantic_display_verified).length,
    deferred_e_candidate_rows: 0,
    classification_counts: count("classification"),
    rule_counts: count("rule_id"),
    exception_rows: records.filter((record) => record.exception.length > 0).length,
    implementation_status_counts: count("implementation_status"),
    journey_counts: count("journey"),
    family_counts: count("family_id"),
    groups: [...groups.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    deferred: {
      "B-listings": "Save, update, submit, and wizard presentation use the public contract. Withdraw, report, contact, and renew in actions/listings.ts keep their previous copy.",
      "B-payments": "Customer checkout unknown outcomes use non-retryable uncertainty. Charges, webhooks, refunds, and entitlements are unchanged. Other payment files stay deferred.",
      C: "Accounts, dealer/admin and remaining journeys stay deferred.",
      D: "Offline handling and page/global boundaries stay deferred.",
      E: "Release-gate lint and unknown-error frequency tracking have no rows in this candidate file and are not implemented.",
    },
  };
}

export function renderReport(summary: ReturnType<typeof summariseInventory>): string {
  const lines = [
    "# Error-message candidate inventory",
    "",
    "Generated by `scripts/error-messages/classify-candidates.ts` from `docs/error-messages/candidates.jsonl`.",
    "The private CSV is not required after checkout. The classifier re-reads the working tree at each recorded file and line.",
    "`semantic_display_verified` means a static producer-to-sink trace (return, JSX, schema, or forwarding catch). It is not a runtime or browser proof.",
    "C-E behaviour is not migrated. Journey names are ownership for later work.",
    "",
    `- Candidates: ${summary.candidate_count}`,
    `- Files: ${summary.file_count}`,
    `- Provenance sha256: ${summary.csv_sha256}`,
    `- Rows with a static display trace: ${summary.semantic_display_verified_count}`,
    `- Rows with a static-limit exception: ${summary.exception_rows}`,
    "",
    "## Counts",
    "",
    `- Classification: ${JSON.stringify(summary.classification_counts)}`,
    `- Rule: ${JSON.stringify(summary.rule_counts)}`,
    `- Implementation status: ${JSON.stringify(summary.implementation_status_counts)}`,
    `- Journey: ${JSON.stringify(summary.journey_counts)}`,
    `- Dynamic family: ${JSON.stringify(summary.family_counts)}`,
    "",
    "## Rules",
    "",
    "- AST enclosing function, call, return, JSX, and catch boundaries decide the class.",
    "- `ast-type-or-import`, `ast-signature`, `ast-binding`, `ast-jsx-close`: irrelevant.",
    "- `ast-diagnostic-call` and `ast-throw-unrendered`: internal-only. An uncaught throw is not treated as displayed copy.",
    "- `ast-public-return`, `ast-public-sink`, `ast-jsx-consumer`, `ast-schema-message`, `ast-throw-forwarded`: displayed.",
    "- `exact-source-repeat`: same trimmed source of at least 24 characters. `duplicate_of` is the first `file:line`.",
    "- `static-limit` exceptions name the function and node kind. They are not a single unverified bucket.",
    "",
    "Repetitive rows share `group_id` in `groups.json`. All original rows stay in `inventory.jsonl`.",
    "",
    "Upload family trace, when present: `classifyUploadError` / `publicErrorBody` -> `app/api/listing-images/*` -> `uploadErrorFromPayload` -> `presentClientUploadError` -> `components/marketplace/image-upload.tsx` `setError`.",
    "Listing save trace: `listingUnknownResult` / `publicErrorBody` -> `actions/listings.ts` create, update, submit, and `sync-images-action` -> `executeCreateListingSubmit` `stayForListingError` -> `create-listing-form.tsx` `setError` / `showFieldErrors`.",
    "Checkout trace: `trustedCheckoutMessage` or `checkoutUnknownResult` -> `actions/payments.ts` and `actions/sample-payments.ts` -> wizard or checkout UI. Return query text is `PAYMENT_RETURN_UNCERTAIN`; confirmed or failed wording waits for `readHostedCheckoutLink`.",
    "",
    "## Batch notes",
    "",
    ...Object.entries(summary.deferred).map(([phase, text]) => `- ${phase}: ${text}`),
    "",
    "Section E has zero candidate rows in this register. It remains a later release gate.",
    "",
    "Upload public boundaries use `lib/forms/public-error.ts` and `lib/media/upload-error-catalog.ts`. Listing save and customer checkout boundaries use the same contract via `lib/listings/save-public-error.ts` and `lib/payments/checkout-public-error.ts`. A boundary status means the file is in that batch, not that every line was rewritten.",
    "",
    "Withdraw, report, contact, renew, admin, and global error pages stay deferred. Section C-E behaviour is not implemented here.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
