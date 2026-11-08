import { AUTH_DIAGNOSTIC_CODES } from "@/lib/monitoring/client-diagnostics";
import { diagnosticTarget, safeRequestDiagnostic } from "@/lib/monitoring/request-diagnostics";
import { safeResourceDiagnostic } from "@/lib/monitoring/resource-diagnostics";

/** Export a closed set of diagnostic facts, never arbitrary tags or extra data. */
export function safeEventEvidence(row: Record<string, unknown>): Record<string, string | number | boolean> {
  const evidence: Record<string, string | number | boolean> = {};
  for (const key of ["inboxId", "attemptId"] as const) {
    if (typeof row[key] === "string" && /^c[a-z0-9]{20,40}$/.test(row[key])) evidence[key] = row[key];
  }
  const categories: Record<string, string[]> = {
    rejectStage: ["hmac", "envelope"], envReason: ["json", "event", "client", "time", "data", "ccy", "shape", "other"],
    ccyState: ["missing", "blank", "wrongtype", "unsupported"],
    processingState: ["FAILED", "QUARANTINED"],
    errorCode: ["UNKNOWN_PRODUCT", "INVALID_REFERENCE", "MISSING_REFERENCE", "AMBIGUOUS_DEALER", "AMOUNT_MISMATCH", "CHARGE_COLLISION", "MISSING_DEALER", "WEBHOOK_PROCESS", "STAGING_RELAY_FAILED"],
  };
  for (const [key, allowed] of Object.entries(categories)) if (allowed.includes(String(row[key]))) evidence[key] = String(row[key]);
  for (const key of ["attemptNumber", "receiptAgeMs"] as const) {
    const value = Number(row[key]);
    if (row[key] != null && Number.isSafeInteger(value) && value >= 0 && value <= 31_536_000_000) evidence[key] = value;
  }
  const diagnostics = row.diagnostics && typeof row.diagnostics === "object"
    ? row.diagnostics as Record<string, unknown> : {};
  if (typeof diagnostics.online === "boolean") evidence.online = diagnostics.online;
  const facts = row.operationFacts && typeof row.operationFacts === "object" ? row.operationFacts as Record<string, unknown> : {};
  const stages = ["auth-profile-persist", "invoice-check-open", "invoice-read-entries", "invoice-create-request", "invoice-freeze-lines", "invoice-workflow-event", "invoice-create-outbox", "storage-upload", "profile-save", "storage-cleanup", "map-worker", "map-initialisation", "map-style-or-network"];
  if (stages.includes(String(facts.stage ?? row.stage))) evidence.stage = String(facts.stage ?? row.stage);
  if (typeof facts.databaseCode === "string" && /^P\d{4}$/.test(facts.databaseCode)) evidence.databaseCode = facts.databaseCode;
  if (typeof facts.durationMs === "number" && Number.isFinite(facts.durationMs) && facts.durationMs >= 0) evidence.durationMs = Math.min(facts.durationMs, 300_000);
  for (const key of ["sameIdentityFound", "retryAttempted"] as const) if (typeof facts[key] === "boolean") evidence[key] = facts[key];
  if (row.missingBucket === "true" || row.missingBucket === "false") evidence.missingBucket = row.missingBucket === "true";
  if (diagnostics.visibility === "visible" || diagnostics.visibility === "hidden") evidence.visibility = diagnostics.visibility;
  if (diagnostics.operation === "sign-in") evidence.operation = "sign-in";
  if (AUTH_DIAGNOSTIC_CODES.some(code => code === diagnostics.authCode)) evidence.authCode = String(diagnostics.authCode);
  if (typeof diagnostics.httpStatus === "number" && Number.isInteger(diagnostics.httpStatus)
    && diagnostics.httpStatus >= 100 && diagnostics.httpStatus <= 599) evidence.httpStatus = diagnostics.httpStatus;
  for (const key of ["requestId", "displayedSupportReference"] as const) {
    const value = row[key];
    if (typeof value === "string" && /^[A-Za-z0-9:_-]{8,160}$/.test(value)) evidence[key] = value;
  }
  for (const key of ["serverRelease", "clientRelease"] as const) if (typeof row[key] === "string" && /^[a-f0-9]{40}$/i.test(row[key])) evidence[key] = row[key];
  if (typeof row.ingestRelease === "string" && /^[a-f0-9]{40}$/i.test(row.ingestRelease)) evidence.ingestRelease = row.ingestRelease;
  if (row.clientStackProvided === "true" || row.clientStackProvided === "false") evidence.clientStackProvided = row.clientStackProvided === "true";
  const resource = safeResourceDiagnostic(row.resource);
  if (resource) {
    for (const [key, value] of Object.entries(resource)) {
      if (value !== undefined) evidence[`resource${key[0].toUpperCase()}${key.slice(1)}`] = value;
    }
  }
  const triggeringRequest = safeRequestDiagnostic(row.triggeringRequest);
  if (triggeringRequest) {
    for (const [key, value] of Object.entries(triggeringRequest)) {
      if (value !== null && value !== undefined) evidence[`triggeringRequest${key[0].toUpperCase()}${key.slice(1)}`] = value;
    }
  }
  if (typeof row.filename === "string") evidence.scriptLocation = diagnosticTarget(row.filename, "https://itrader.im") ?? "unavailable";
  for (const key of ["line", "col"] as const) {
    const value = Number(row[key]);
    if (row[key] != null && Number.isInteger(value) && value >= 0 && value <= 10_000_000) evidence[key] = value;
  }
  const agent = typeof row.userAgent === "string" ? row.userAgent.slice(0, 500) : "";
  evidence.browserFamily = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\/|CriOS\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "unknown";
  return evidence;
}
