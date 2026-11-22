import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origin = "https://itrader.dev";
const root = "/opt/itrader-stock";
const profile = process.argv[3];
const stateDir = /^admin[12]$/.test(profile ?? "") ? "/var/lib/itrader-stock-preview-" + profile : null;
const sessionFile = stateDir + "/session.json";
const environment = "preview";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

async function post(path, data, bearer) {
  const response = await fetch(origin + "/api/stock-worker" + path, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) },
    body: JSON.stringify(data),
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("iTrader request failed (" + response.status + ")");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 16384) throw new Error("Oversized iTrader response");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function session(data) {
  if (data?.environment !== environment || !tokenPattern.test(data.accessToken) ||
      !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) {
    throw new Error("Preview device session is invalid or expired");
  }
  return { accessToken: data.accessToken, environment, expiresAt: data.expiresAt };
}

async function loadSession() {
  const file = await open(sessionFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 4096) {
      throw new Error("Invalid session file permissions");
    }
    return session(JSON.parse(await file.readFile("utf8")));
  } finally { await file.close(); }
}

async function pair() {
  const verifier = randomBytes(48).toString("base64url");
  const data = await post("", { op: "begin", environment, deviceName: "Oracle Stock Update VM",
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"), clientVersion: "1.1.15-linux.1" });
  const url = new URL(data.verificationUri);
  if (url.origin !== origin || url.pathname !== "/admin/stock-worker" || !tokenPattern.test(data.deviceCode)) throw new Error("Invalid pairing response");
  console.log("Approve this Preview device in your administrator browser:", url.href);
  const expires = Date.now() + Math.min(data.expiresIn, 600) * 1000;
  while (Date.now() < expires) {
    await delay(Math.max(5, Math.min(30, data.interval)) * 1000);
    const value = await post("", { op: "poll", deviceCode: data.deviceCode, codeVerifier: verifier });
    if (value.status === "pending") continue;
    const saved = session(value);
    const temp = sessionFile + "." + randomUUID();
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(saved)); await file.sync(); } finally { await file.close(); }
    await rename(temp, sessionFile);
    console.log("Preview device paired through", saved.expiresAt);
    return;
  }
  throw new Error("Pairing code expired");
}

export function validateCommand(command, instanceId) {
  if (!command || !uuid.test(command.id) || command.instanceId !== instanceId || !uuid.test(instanceId)) throw new Error("Invalid command identity");
  if (command.action === "start") {
    const ids = command.jobIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length ||
        ids.some(id => typeof id !== "string" || !/^[a-z0-9]{8,40}$/.test(id))) throw new Error("Invalid job scope");
  } else if (!["stop", "close"].includes(command.action) || command.jobIds !== undefined) throw new Error("Invalid command");
  return command;
}

async function serve() {
  const saved = await loadSession();
  const instanceId = randomUUID();
  let child, complete, acknowledgedCommandId = null, quitting = false, state = "connected", sequence = 0;
  const activity = [];
  const record = code => {
    activity.push({ code, sequence: ++sequence, at: new Date().toISOString() });
    if (activity.length > 40) activity.shift();
  };
  const stop = () => { if (child) { state = "stopping"; child.stdin.end(); } };
  process.on("SIGTERM", () => { quitting = true; stop(); });
  process.on("SIGINT", () => { quitting = true; stop(); });
  const heartbeat = () => post("/control", { op: "heartbeat", instanceId, state, activity, acknowledgedCommandId }, saved.accessToken);
  function start(jobIds) {
    if (child) throw new Error("Previous run is still active");
    const worker = spawn("/usr/bin/flock", ["--nonblock", "--conflict-exit-code", "75", "/run/itrader-stock/jobs.lock", "/usr/bin/xvfb-run", "-a", "-s", "-screen 0 1440x1100x24 -nolisten tcp", process.execPath, "--import", "tsx", "scripts/dealer-stock-sync/desktop-worker.ts", "--mode", "watch"], {
      cwd: root + "/worker", env: { PATH: root + "/runtime/bin:/usr/bin:/bin", NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"],
    });
    child = worker;
    complete = new Promise(done => worker.once("close", code => {
      child = null; state = code === 0 ? "stopped" : "error"; record(code === 75 ? "vm-busy" : code === 0 ? "stopped" : "error"); done();
    }));
    worker.on("error", () => { state = "error"; });
    worker.stdin.on("error", () => { state = "error"; });
    createInterface({ input: worker.stdout }).on("line", line => {
      try {
        const event = JSON.parse(line);
        if (["checking","ready","processing","staging-photos","processing-finished","applied","stopping","stopped"].includes(event.state)) record(event.state);
      } catch { /* Only structured worker events are published. */ }
    });
    state = "running";
    worker.stdin.write(JSON.stringify({environment, accessToken: saved.accessToken, jobIds}) + "\n");
  }
  try {
    while (!quitting) {
      const result = await heartbeat();
      if (result.ok !== true || !Object.hasOwn(result,"command")) throw new Error("Invalid heartbeat");
      if (quitting) break;
      if (result.command !== null) {
        const cmd = validateCommand(result.command, instanceId);
        if (cmd.id !== acknowledgedCommandId) {
          if (cmd.action === "start") start(cmd.jobIds);
          else { stop(); if (cmd.action === "close") quitting = true; }
          acknowledgedCommandId = cmd.id;
        }
      }
      if (!quitting) await delay(10000);
    }
  } finally {
    stop();
    await complete;
    state = "disconnected";
    await heartbeat().catch(() => {});
  }
}

async function main() {
  process.umask(0o077);
  if (process.platform !== "linux" || process.arch !== "arm64" || process.getuid() === 0) throw new Error("Requires an unprivileged Linux Arm64 account");
  if (!stateDir) throw new Error("Choose the admin1 or admin2 pairing profile");
  const mode = process.argv[2];
  if (mode === "pair") return pair();
  if (mode === "serve") return serve();
  if (mode === "revoke") {
    const saved = await loadSession(); await post("", { op: "revoke" }, saved.accessToken); await unlink(sessionFile); return;
  }
  throw new Error("Choose pair, serve or revoke");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
