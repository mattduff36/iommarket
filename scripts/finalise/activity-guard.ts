import { existsSync, readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";

export interface TerminalActivity {
  filePath: string;
  pid: number | null;
  command: string;
  startedAt: string | null;
  isRunning: boolean;
  isAgentReview: boolean;
  isFinalise: boolean;
}

export interface FinaliseActivityCheck {
  terminalDirectory: string;
  activities: TerminalActivity[];
  blockingActivities: TerminalActivity[];
}

export function getCursorProjectFolderName(repoRoot: string) {
  const normalized = repoRoot.replace(/\\/gu, "/").replace(/\/$/u, "");
  const driveMatch = normalized.match(/^([a-zA-Z]):\/(.+)$/u);
  if (driveMatch) {
    return `${driveMatch[1].toLowerCase()}-${driveMatch[2].replace(/\//gu, "-")}`;
  }
  return normalized.replace(/^\/+/u, "").replace(/\//gu, "-");
}

export function getDefaultTerminalDirectory(repoRoot: string) {
  if (process.env.CURSOR_TERMINALS_DIR) return process.env.CURSOR_TERMINALS_DIR;
  return path.join(os.homedir(), ".cursor", "projects", getCursorProjectFolderName(repoRoot), "terminals");
}

function getHeader(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  return match?.[1] ?? "";
}

function getHeaderValue(header: string, key: string) {
  const match = header.match(new RegExp(`^${key}:\\s*(.*)$`, "imu"));
  return match?.[1]?.trim().replace(/^"|"$/gu, "") ?? "";
}

function getCommandFromHeader(header: string) {
  return getHeaderValue(header, "active_command") || getHeaderValue(header, "command") || getHeaderValue(header, "last_command");
}

function getPidFromHeader(header: string) {
  const raw = getHeaderValue(header, "pid");
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExitFooter(content: string) {
  return /(?:^|\r?\n)---\r?\nexit_code:/u.test(content);
}

function isTerminalCommandRunning(header: string, content: string) {
  if (hasExitFooter(content)) return false;
  if (/^running_for_ms:/imu.test(header)) return true;
  if (/^active_command:/imu.test(header)) return true;
  return /^started_at:/imu.test(header);
}

export function parseTerminalActivity(filePath: string, content: string): TerminalActivity | null {
  const header = getHeader(content);
  if (!header) return null;
  const command = getCommandFromHeader(header);
  return {
    filePath,
    pid: getPidFromHeader(header),
    command,
    startedAt: getHeaderValue(header, "started_at") || null,
    isRunning: isTerminalCommandRunning(header, content),
    isAgentReview: /\bagent\s+review\b|\breviewing your changes\b/iu.test(content),
    isFinalise: /\b(finalise|finalize)(?::(?:full|push))*\b/iu.test(command.toLowerCase()),
  };
}

export function checkFinaliseBlockingActivity(repoRoot: string, ignoredPids: number[] = []): FinaliseActivityCheck {
  const terminalDirectory = getDefaultTerminalDirectory(repoRoot);
  if (!existsSync(terminalDirectory)) {
    return { terminalDirectory, activities: [], blockingActivities: [] };
  }

  const activities = readdirSync(terminalDirectory)
    .filter((fileName) => fileName.endsWith(".txt"))
    .map((fileName) => parseTerminalActivity(path.join(terminalDirectory, fileName), readFileSync(path.join(terminalDirectory, fileName), "utf8")))
    .filter((activity): activity is TerminalActivity => activity != null);

  const ignoredPidSet = new Set(ignoredPids.filter((pid) => Number.isFinite(pid)));
  const blockingActivities = activities.filter(
    (activity) =>
      activity.isRunning &&
      !ignoredPidSet.has(activity.pid ?? -1) &&
      (activity.isAgentReview || activity.isFinalise),
  );

  return { terminalDirectory, activities, blockingActivities };
}

export function formatBlockingActivity(activity: TerminalActivity) {
  const labels = [activity.isAgentReview ? "Agent Review" : null, activity.isFinalise ? "finalise" : null]
    .filter(Boolean)
    .join(", ");
  return `${path.basename(activity.filePath)} (${labels || "unknown"}): ${activity.command || "no command recorded"}`;
}

export function assertNoBlockingCursorActivity(
  repoRoot: string,
  ignoredPids: number[] = [],
  options: { ignoreFinalise?: boolean } = {},
) {
  const activityCheck = checkFinaliseBlockingActivity(repoRoot, ignoredPids);
  const nowMs = Date.now();
  const blockingActivities = activityCheck.blockingActivities.filter((activity) => {
    if (options.ignoreFinalise && activity.isFinalise && !activity.isAgentReview) return false;
    if (!activity.isFinalise || activity.isAgentReview || !activity.startedAt) return true;
    const startedAtMs = Date.parse(activity.startedAt);
    if (Number.isNaN(startedAtMs)) return true;
    // Cursor writes the current terminal metadata before this script can run.
    // Ignore only a finalise terminal that has just started, which is this invocation.
    return Math.abs(nowMs - startedAtMs) > 60_000;
  });
  if (blockingActivities.length === 0) return;

  throw new Error(
    [
      "Blocking Cursor activity detected before finalise:",
      ...blockingActivities.map((activity) => `- ${formatBlockingActivity(activity)}`),
      `Terminal directory checked: ${activityCheck.terminalDirectory}`,
      "Wait for the active Agent Review/finalise run to finish, then rerun finalise.",
    ].join("\n"),
  );
}
