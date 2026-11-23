import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { oracleSessionFile, oracleTarget } from "./oracle-runtime.mjs";

const root = "/opt/itrader-stock";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const requestPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function invitationCode(line, target = oracleTarget()) {
  const invitationPrefix = "Approve this " + target.label + " device in your administrator browser: ";
  if (!line.startsWith(invitationPrefix)) return null;
  const url = new URL(line.slice(invitationPrefix.length));
  const code = url.searchParams.get("code");
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code ?? "") ||
      url.href !== target.origin + "/admin/stock-worker?code=" + code) {
    throw new Error("Controller returned an invalid pairing invitation");
  }
  return code;
}

async function post(target, path, token, payload) {
  return fetch(target.origin + path, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify(payload),
  });
}

async function broker(target, token, payload) {
  const response = await post(target, "/api/stock-worker/oracle-pairing", token, payload);
  if (!response.ok) throw new Error("Pairing broker responded " + response.status);
  const value = await response.json();
  if (value?.ok !== true) throw new Error("Invalid pairing broker response");
  return value;
}

export async function explicitlyRevoked(response) {
  if (response.status !== 401 || !response.headers.get("content-type")?.startsWith("application/json")) {
    await response.body?.cancel();
    return false;
  }
  return (await response.json()).error === "unauthorized";
}

export async function sessionAllowsPairing(target, filename, verify = post) {
  let file;
  try {
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  let saved;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 4096) {
      throw new Error("Unsafe Oracle session file");
    }
    saved = JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
  if (saved?.environment !== target.environment || !tokenPattern.test(saved.accessToken ?? "")) {
    throw new Error("Unexpected saved session");
  }
  // Only an explicit rejection by the existing session endpoint permits replacement.
  // A proxy sign-in page, an account access change or an outage preserves the file.
  const response = await verify(target, "/api/stock-worker", saved.accessToken, { op: "session" });
  return explicitlyRevoked(response);
}

function beginPairing(target, profile) {
  const child = spawn(process.execPath, [root + "/controller.mjs", "pair", profile, target.environment], {
    env: { PATH: root + "/runtime/bin:/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const attempt = { done: false, code: null };
  const lines = createInterface({ input: child.stdout });
  attempt.code = new Promise((resolveCode, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Oracle invitation timed out"));
      child.kill();
    }, 15_000);
    lines.on("line", line => {
      try {
        const code = invitationCode(line, target);
        if (code) { clearTimeout(timer); resolveCode(code); }
      } catch (error) {
        reject(error);
        child.kill();
      }
    });
    child.on("error", () => reject(new Error("Could not start the pairing controller")));
    child.once("close", status => {
      clearTimeout(timer);
      attempt.done = true;
      if (status !== 0) console.error("Oracle pairing ended without a new session");
      reject(new Error("Pairing controller exited before an invitation"));
    });
  });
  return attempt;
}

async function run(profile, environment) {
  const target = oracleTarget(environment);
  const filename = oracleSessionFile(target, profile);
  if (process.platform !== "linux" || process.arch !== "arm64" || process.getuid() === 0 ||
      !process.env.CREDENTIALS_DIRECTORY) {
    throw new Error("Requires an unprivileged Oracle pairing service profile");
  }
  const token = (await readFile(join(process.env.CREDENTIALS_DIRECTORY, "oracle-token"), "utf8")).trim();
  if (!tokenPattern.test(token)) throw new Error("Invalid pairing agent credential");
  let attempt;
  let unavailable = false;
  for (;;) {
    try {
      const { requestId } = await broker(target, token, { op: "poll" });
      if (requestId !== null) {
        if (!requestPattern.test(requestId ?? "")) throw new Error("Invalid pairing request");
        let code;
        try {
          if (!attempt || attempt.done) {
            if (!await sessionAllowsPairing(target, filename)) throw new Error("Current session cannot be replaced");
            attempt = beginPairing(target, profile);
          }
          code = await attempt.code;
        } catch {
          await broker(target, token, { op: "failed", requestId });
        }
        if (code) await broker(target, token, { op: "ready", requestId, code });
      }
      unavailable = false;
    } catch {
      if (!unavailable) console.error("Oracle pairing broker unavailable; retrying");
      unavailable = true;
    }
    await delay(attempt && !attempt.done ? 5000 : 25_000);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2], process.argv[3]).catch(() => {
    console.error("Oracle pairing agent could not start");
    process.exitCode = 1;
  });
}
