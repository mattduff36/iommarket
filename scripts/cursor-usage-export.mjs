#!/usr/bin/env node
/**
 * Exports Cursor token usage for this project into a committed log that the
 * deployed cost ledger reads. Credentials are read from the local Cursor
 * installation at run time and never written to the log or the repository.
 *
 * Usage: node --experimental-sqlite scripts/cursor-usage-export.mjs [--days 30]
 * Exit code 0 with a warning when usage cannot be collected, so commits are
 * never blocked by an offline machine or a signed-out editor.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const LOG_VERSION = 1;
const LOG_PATH = path.join("data", "cursor-usage.json");
const DASHBOARD_ORIGIN = "https://cursor.com";
const EVENTS_ENDPOINT = `${DASHBOARD_ORIGIN}/api/dashboard/get-filtered-usage-events`;
const EVENT_PAGE_SIZE = 250;
const MAX_EVENT_PAGES = 40;
const REQUEST_TIMEOUT_MS = 20_000;
const MICRO = 1_000_000;

function fail(message) {
  process.stderr.write(`cursor-usage-export: ${message}\n`);
  process.exit(0);
}

function stateDatabasePath() {
  const appData =
    process.env.APPDATA ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : path.join(homedir(), ".config"));
  return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
}

function readCursorCredentials() {
  const dbPath = stateDatabasePath();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const select = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const read = (key) => {
      const row = select.get(key);
      if (!row || typeof row.value !== "string") return null;
      return row.value.replace(/^"|"$/g, "").trim() || null;
    };
    const accessToken = read("cursorAuth/accessToken");
    const authId = read("cursorAuth/stripeMembershipAuthId");
    if (!accessToken || !authId) return null;
    return { cookie: `WorkosCursorSessionToken=${authId}%3A%3A${accessToken}` };
  } finally {
    db.close();
  }
}

async function postJson(url, body, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: DASHBOARD_ORIGIN,
        Referer: `${DASHBOARD_ORIGIN}/dashboard`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status === 307 || response.status === 401 || response.status === 403) {
      throw new Error("Cursor session is not authorised; sign in to Cursor and retry.");
    }
    if (!response.ok) {
      throw new Error(`Cursor dashboard returned ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Maps Cursor conversation ids to the project directory that owns them. */
function buildConversationProjectIndex() {
  const root = path.join(homedir(), ".cursor", "projects");
  const index = new Map();
  let projects;
  try {
    projects = readdirSync(root);
  } catch {
    return index;
  }
  for (const project of projects) {
    const transcripts = path.join(root, project, "agent-transcripts");
    let entries;
    try {
      entries = readdirSync(transcripts);
    } catch {
      continue;
    }
    for (const entry of entries) {
      index.set(entry.replace(/\.jsonl$/, ""), project);
    }
  }
  return index;
}

function projectKeyForWorkspace() {
  const cwd = process.cwd();
  const drive = cwd.slice(0, 1).toLowerCase();
  const rest = cwd.slice(2).replace(/\\/g, "-").replace(/\//g, "-").replace(/^-/, "");
  return `${drive}-${rest}`;
}

function centsToMicro(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * MICRO);
}

function dayKey(timestampMs) {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/**
 * The project's usage and the identified-project total come from the same event
 * stream, so a day's share can never exceed the whole. Usage that no local
 * transcript claims is excluded from both sides rather than guessed at.
 */
async function collectUsage(cookie, fromMs, toMs, projectKey) {
  const index = buildConversationProjectIndex();
  const totals = new Map();
  const byDay = new Map();
  let attributed = 0;
  let unattributed = 0;
  let unattributedMicroCents = 0;

  for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
    const body = await postJson(
      EVENTS_ENDPOINT,
      {
        teamId: 0,
        startDate: String(fromMs),
        endDate: String(toMs),
        page,
        pageSize: EVENT_PAGE_SIZE,
      },
      cookie,
    );
    const events = Array.isArray(body?.usageEventsDisplay) ? body.usageEventsDisplay : [];
    if (events.length === 0) break;

    for (const event of events) {
      const timestamp = Number(event?.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const owner = event?.conversationId ? index.get(event.conversationId) : undefined;
      const key = dayKey(timestamp);
      const eventMicro = centsToMicro(event?.tokenUsage?.totalCents ?? event?.chargedCents);
      if (owner) {
        attributed += 1;
        totals.set(key, (totals.get(key) ?? 0) + eventMicro);
      } else {
        unattributed += 1;
        unattributedMicroCents += eventMicro;
        if (!totals.has(key)) totals.set(key, 0);
      }
      if (owner !== projectKey) continue;

      const day =
        byDay.get(key) ??
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          onDemandMicroCents: 0,
          chargedMicroCents: 0,
          models: new Map(),
        };
      const usage = event?.tokenUsage ?? {};
      const onDemand = eventMicro;
      day.inputTokens += Number(usage?.inputTokens) || 0;
      day.outputTokens += Number(usage?.outputTokens) || 0;
      day.cacheWriteTokens += Number(usage?.cacheWriteTokens) || 0;
      day.cacheReadTokens += Number(usage?.cacheReadTokens) || 0;
      day.onDemandMicroCents += onDemand;
      day.chargedMicroCents += event?.isChargeable === true ? centsToMicro(event?.chargedCents) : 0;
      const model = typeof event?.model === "string" ? event.model : "unknown";
      day.models.set(model, (day.models.get(model) ?? 0) + onDemand);
      byDay.set(key, day);
    }

    if (events.length < EVENT_PAGE_SIZE) break;
  }

  return { totals, byDay, attributed, unattributed, unattributedMicroCents };
}

function parseDaysArgument() {
  const flag = process.argv.indexOf("--days");
  if (flag === -1) return 45;
  const value = Number(process.argv[flag + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    fail("--days must be an integer between 1 and 365.");
  }
  return value;
}

async function main() {
  const days = parseDaysArgument();
  let credentials;
  try {
    credentials = readCursorCredentials();
  } catch (error) {
    fail(`local Cursor state is unreadable (${error.message}); usage log unchanged.`);
  }
  if (!credentials) {
    fail("no local Cursor session found; usage log unchanged.");
  }

  const projectKey = projectKeyForWorkspace();
  const midnightUtc = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const fromMs = midnightUtc - (days - 1) * 86_400_000;
  const toMs = midnightUtc + 86_400_000;

  let usage;
  try {
    usage = await collectUsage(credentials.cookie, fromMs, toMs, projectKey);
  } catch (error) {
    fail(`${error.message} Usage log unchanged.`);
  }

  const { totals, ...project } = usage;
  const dayKeys = [...totals.keys()].sort();
  const log = {
    version: LOG_VERSION,
    generatedAt: new Date().toISOString(),
    projectKey,
    windowStart: new Date(fromMs).toISOString(),
    windowEnd: new Date(toMs).toISOString(),
    attributionCoverage: {
      attributedEvents: project.attributed,
      unattributedEvents: project.unattributed,
      unattributedMicroCents: String(project.unattributedMicroCents),
    },
    days: dayKeys.map((date) => {
      const projectDay = project.byDay.get(date);
      return {
        date,
        identifiedMicroCents: String(totals.get(date) ?? 0),
        project: {
          onDemandMicroCents: String(projectDay?.onDemandMicroCents ?? 0),
          chargedMicroCents: String(projectDay?.chargedMicroCents ?? 0),
          inputTokens: projectDay?.inputTokens ?? 0,
          outputTokens: projectDay?.outputTokens ?? 0,
          cacheWriteTokens: projectDay?.cacheWriteTokens ?? 0,
          cacheReadTokens: projectDay?.cacheReadTokens ?? 0,
          models: [...(projectDay?.models ?? new Map())]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([model, onDemandMicroCents]) => ({
              model,
              onDemandMicroCents: String(onDemandMicroCents),
            })),
        },
      };
    }),
  };

  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, `${JSON.stringify(log, null, 2)}\n`, { encoding: "utf8" });
  const size = statSync(LOG_PATH).size;
  process.stdout.write(
    `cursor-usage-export: ${log.days.length} days, ${project.attributed} attributed events, ${size} bytes\n`,
  );
}

await main();
