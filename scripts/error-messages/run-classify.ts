import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCandidates,
  hashText,
  parseCandidateCsv,
  parseProvenance,
  renderReport,
  summariseInventory,
  type CandidateRow,
} from "./classify-candidates";

const root = fileURLToPath(new URL("../..", import.meta.url));
const csvPath = join(root, "private/automation/error-message-candidates.csv");
const outDir = join(root, "docs/error-messages");
const provenancePath = join(outDir, "candidates.jsonl");

function assertNoSecrets(rows: CandidateRow[]) {
  const secret = /(sk_live|AKIA[0-9A-Z]{16}|-----BEGIN |postgres:\/\/|eyJ[A-Za-z0-9_-]{20,}\.)/;
  for (const row of rows) {
    if (secret.test(row.source)) {
      throw new Error(`Refusing to write a candidate that looks like a secret: ${row.file}:${row.line}`);
    }
  }
}

function provenanceText(rows: CandidateRow[]): string {
  return `${rows.map((row) => JSON.stringify({ file: row.file, line: row.line, source: row.source })).join("\n")}\n`;
}

let rows: CandidateRow[];
if (existsSync(provenancePath)) {
  rows = parseProvenance(readFileSync(provenancePath, "utf8"));
} else if (existsSync(csvPath)) {
  rows = parseCandidateCsv(readFileSync(csvPath, "utf8"));
} else {
  throw new Error("Missing docs/error-messages/candidates.jsonl. The private CSV is optional and was not found.");
}
assertNoSecrets(rows);
if (existsSync(csvPath)) {
  const fromCsv = parseCandidateCsv(readFileSync(csvPath, "utf8"));
  if (fromCsv.length !== rows.length) {
    throw new Error(`Provenance has ${rows.length} rows; private CSV has ${fromCsv.length}.`);
  }
}

const records = classifyCandidates(rows, root);
const summary = summariseInventory(records, hashText(provenanceText(rows)));
mkdirSync(outDir, { recursive: true });
if (!existsSync(provenancePath)) writeFileSync(provenancePath, provenanceText(rows));
writeFileSync(join(outDir, "inventory.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
writeFileSync(join(outDir, "groups.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outDir, "report.md"), renderReport(summary));
process.stdout.write(`classified ${records.length} candidates in ${summary.file_count} files\n`);
process.stdout.write(`${JSON.stringify(summary.classification_counts)}\n`);
process.stdout.write(`static traces ${summary.semantic_display_verified_count}; exceptions ${summary.exception_rows}\n`);
