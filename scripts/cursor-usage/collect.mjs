#!/usr/bin/env node
/**
 * Bounded Cursor collection into a local outbox. Does not write data/cursor-usage.json
 * and does not stage Git changes. Credentials stay in the local Cursor state database.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  EVENTS_ENDPOINT,
  buildConversationProjectIndex,
  postJson,
  projectKeyForWorkspace,
  readCursorCredentials,
} from "./cursor-adapter.mjs";

function outboxPath() {
  if (process.env.CURSOR_USAGE_OUTBOX?.trim()) return process.env.CURSOR_USAGE_OUTBOX.trim();
  const base = process.env.LOCALAPPDATA || path.join(homedir(), ".local", "share");
  return path.join(base, "iommarket", "cursor-usage.sqlite");
}

function openOutbox() {
  const file = outboxPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_events (
      id TEXT PRIMARY KEY,
      provider_account_ref TEXT NOT NULL,
      payload TEXT NOT NULL,
      attribution_status TEXT NOT NULL,
      project_ref TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function identityBaseFor(event) {
  return [
    event.timestamp,
    event.model,
    event.conversationId ?? "",
    event.kind ?? "",
    event.isTokenBasedCall === true ? "1" : event.isTokenBasedCall === false ? "0" : "",
  ].join("|");
}

function eventId(providerAccountRef, identityBase, occurrence) {
  return createHash("sha256")
    .update(`${providerAccountRef}|${identityBase}|${occurrence}`)
    .digest("hex");
}

function migrateOutboxIdentity(db, providerAccountRef) {
  const version = db.prepare("SELECT value FROM meta WHERE key = 'identity_version'").get();
  if (version?.value === "2") return;
  const rows = db.prepare("SELECT id, payload FROM events ORDER BY id").all();
  const occurrences = new Map();
  const update = db.prepare("UPDATE events SET id = ? WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const payload = JSON.parse(row.payload);
      const identityBase = identityBaseFor(payload);
      const occurrence = occurrences.get(identityBase) ?? 0;
      occurrences.set(identityBase, occurrence + 1);
      update.run(eventId(providerAccountRef, identityBase, occurrence), row.id);
    }
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('identity_version', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function report(message) {
  process.stderr.write(`cursor-usage: ${message}\n`);
}

async function fetchEvents(cookie, maxPages, from, to) {
  const events = [];
  let reported = null;
  let capped = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await postJson(
      EVENTS_ENDPOINT,
      {
        teamId: 0,
        startDate: String(from),
        endDate: String(to),
        page,
        pageSize: 250,
      },
      cookie,
    );
    const batch = Array.isArray(body?.usageEventsDisplay) ? body.usageEventsDisplay : [];
    if (typeof body?.totalUsageEventsCount === "number") reported = body.totalUsageEventsCount;
    events.push(...batch);
    if (batch.length < 250) break;
    if (page === maxPages) capped = true;
  }
  const quality = capped || (reported !== null && reported !== events.length) ? "partial" : reported === null ? "unknown" : "complete";
  return { events, reported, quality, from, to };
}

function collectionWindow(db) {
  const now = Date.now();
  const previous = db.prepare("SELECT value FROM meta WHERE key = 'last_success'").get();
  const previousMs = Date.parse(previous?.value ?? "");
  if (!Number.isFinite(previousMs)) {
    return { from: now - 2 * 86_400_000, to: now };
  }
  const earliest = now - 45 * 86_400_000;
  const from = Math.max(earliest, previousMs - 86_400_000);
  return { from, to: Math.min(now, from + 2 * 86_400_000) };
}

function storeEvents(db, events, projectKey, providerAccountRef) {
  const index = buildConversationProjectIndex();
  const insert = db.prepare(
    `INSERT INTO events (id, payload, status, created_at)
     VALUES (?, ?, 'pending', ?)
     ON CONFLICT(id) DO UPDATE SET
       status = CASE WHEN events.payload <> excluded.payload THEN 'pending' ELSE events.status END,
       payload = excluded.payload`,
  );
  const retainAccountEvent = db.prepare(
    `INSERT INTO account_events (
       id, provider_account_ref, payload, attribution_status, project_ref, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       attribution_status = excluded.attribution_status,
       project_ref = excluded.project_ref,
       updated_at = excluded.updated_at`,
  );
  const occurrences = new Map();
  let itrader = 0;
  const now = new Date().toISOString();
  for (const event of events) {
    const conversationId = typeof event?.conversationId === "string" ? event.conversationId : null;
    const owner = conversationId ? index.get(conversationId) : undefined;
    const kind = typeof event?.kind === "string" ? event.kind : null;
    const model =
      typeof event?.model === "string" && event.model.trim()
        ? event.model
        : "unknown";
    const numericTimestamp = Number(event.timestamp);
    const occurredAt = Number.isFinite(numericTimestamp) && numericTimestamp > 1_000_000_000_000
      ? new Date(numericTimestamp)
      : new Date(event.timestamp);
    if (Number.isNaN(occurredAt.getTime())) continue;
    const sanitized = {
      timestamp: occurredAt.toISOString(),
      model,
      kind,
      conversationId,
      isTokenBasedCall: event.isTokenBasedCall ?? null,
      chargedCents: event.chargedCents ?? null,
      usageBasedCosts:
        typeof event.usageBasedCosts === "string" ? event.usageBasedCosts : null,
      cursorTokenFee: event.cursorTokenFee ?? null,
      tokenUsage: event.tokenUsage ?? null,
    };
    const identityBase = identityBaseFor(sanitized);
    const occurrence = occurrences.get(identityBase) ?? 0;
    occurrences.set(identityBase, occurrence + 1);
    const id = eventId(providerAccountRef, identityBase, occurrence);
    retainAccountEvent.run(
      id,
      providerAccountRef,
      JSON.stringify(sanitized),
      owner ? "assigned" : "unassigned",
      owner ?? null,
      now,
    );
    if (owner !== projectKey || !conversationId || !kind) continue;
    itrader += 1;
    insert.run(
      id,
      JSON.stringify({
        ...sanitized,
        attribution: { projectId: "itrader", status: "assigned" },
      }),
      now,
    );
  }
  return { itrader };
}

function pendingBatches(db, maxBatches) {
  const rows = db
    .prepare("SELECT id, payload FROM events WHERE status = 'pending' ORDER BY id LIMIT 1000")
    .all();
  const byDay = new Map();
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    const day = String(payload.timestamp ?? "").slice(0, 10) || "unknown";
    const current = byDay.get(day) ?? [];
    current.push({ ...row, payload, rawPayload: row.payload });
    byDay.set(day, current);
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .flatMap(([, dayRows]) => {
      const chunks = [];
      for (let index = 0; index < dayRows.length; index += 200) {
        chunks.push(dayRows.slice(index, index + 200));
      }
      return chunks;
    })
    .slice(0, maxBatches);
}

function uploadIdempotencyKey(batch) {
  return `collect-${createHash("sha256")
    .update(
      batch
        .map(
          (row) =>
            `${row.id}:${createHash("sha256").update(row.rawPayload).digest("hex")}`,
        )
        .sort()
        .join("|"),
    )
    .digest("hex")
    .slice(0, 40)}`;
}

async function flush(db, quality, providerAccountRef, maxBatches) {
  const origin = process.env.COST_LEDGER_ORIGIN?.trim().replace(/\/$/, "");
  const secret = process.env.COST_LEDGER_INGEST_SECRET?.trim();
  const batches = pendingBatches(db, maxBatches);
  if (!origin || !secret) {
    report(`collection saved locally; upload waiting for ledger origin. Quality ${quality}.`);
    return;
  }
  if (batches.length === 0) {
    report(`no pending iTrader events. Quality ${quality}.`);
    return;
  }
  const mark = db.prepare("UPDATE events SET status = 'uploaded' WHERE id = ?");
  const review = db.prepare("UPDATE events SET status = 'review' WHERE id = ?");
  for (const batch of batches) {
    const response = await fetch(`${origin}/api/internal/cost-ledger/events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": uploadIdempotencyKey(batch),
      },
      body: JSON.stringify({
        contractVersion: "cost-ledger-v1",
        projectId: "itrader",
        providerAccountRef,
        sourceQuality: quality === "complete" ? "complete" : "partial",
        events: batch.map((row) => row.payload),
      }),
    });
    const result = await response.json().catch(() => null);
    if (
      response.status === 409 &&
      typeof result?.error === "string" &&
      result.error.startsWith("Legacy Cursor subscription-share lines")
    ) {
      for (const row of batch) review.run(row.id);
      report(`held ${batch.length} legacy-overlap events for review.`);
      continue;
    }
    if (!response.ok) {
      report(`upload unavailable (${response.status}). ${batch.length} events remain pending.`);
      continue;
    }
    if (!["succeeded", "duplicate"].includes(result?.data?.status)) {
      report(`upload not acknowledged. ${batch.length} events remain pending.`);
      continue;
    }
    for (const row of batch) mark.run(row.id);
    report(`uploaded ${batch.length} iTrader events. Quality ${quality}.`);
  }
}

async function main() {
  const bounded = process.argv.includes("--bounded");
  let credentials;
  try {
    credentials = readCursorCredentials();
  } catch (error) {
    report(`unavailable (${error instanceof Error ? error.message : "unreadable"}). Existing outbox kept.`);
    return;
  }
  if (!credentials) {
    report("unavailable (no local Cursor session). Existing outbox kept.");
    return;
  }

  const db = openOutbox();
  try {
    migrateOutboxIdentity(db, credentials.providerAccountRef);
    const window = collectionWindow(db);
    const fetched = await fetchEvents(
      credentials.cookie,
      bounded ? 2 : 8,
      window.from,
      window.to,
    );
    const stored = storeEvents(
      db,
      fetched.events,
      projectKeyForWorkspace(),
      credentials.providerAccountRef,
    );
    if (fetched.quality === "complete") {
      db.prepare("INSERT INTO meta (key, value) VALUES ('last_success', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(new Date(fetched.to).toISOString());
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('quality', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(fetched.quality);
    await flush(
      db,
      fetched.quality,
      credentials.providerAccountRef,
      bounded ? 4 : 20,
    );
    const pending = db.prepare("SELECT COUNT(*) AS count FROM events WHERE status = 'pending'").get();
    const review = db.prepare("SELECT COUNT(*) AS count FROM events WHERE status = 'review'").get();
    report(
      `account events ${fetched.events.length}/${fetched.reported ?? "unknown"}, iTrader attributed ${stored.itrader}, pending ${pending?.count ?? 0}, review ${review?.count ?? 0}, quality ${fetched.quality}.`,
    );
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (error) {
  report(`unavailable (${error instanceof Error ? error.message : "collection failed"}).`);
}
