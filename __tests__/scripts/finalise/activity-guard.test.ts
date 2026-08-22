import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoBlockingCursorActivity,
  getCursorProjectFolderName,
  parseTerminalActivity,
} from "../../../scripts/finalise/activity-guard";

const terminalRoots: string[] = [];

function writeTerminal(content: string) {
  const directory = path.join(tmpdir(), `finalise-terminals-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "1.txt"), content, "utf8");
  terminalRoots.push(directory);
  return directory;
}

afterEach(() => {
  delete process.env.CURSOR_TERMINALS_DIR;
  for (const directory of terminalRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("finalise activity guard", () => {
  it("maps a Windows repo path to the Cursor terminals folder name", () => {
    expect(getCursorProjectFolderName("D:/Websites/iommarket")).toBe("d-Websites-iommarket");
  });

  it("detects running terminal-visible Agent Review output", () => {
    const activity = parseTerminalActivity("1.txt", [
      "---",
      "pid: 123",
      "cwd: |",
      "  D:/Websites/iommarket",
      "active_command: Agent Review",
      "---",
      "Reviewing your changes...",
    ].join("\n"));

    expect(activity?.isRunning).toBe(true);
    expect(activity?.isAgentReview).toBe(true);
    expect(activity?.pid).toBe(123);
  });

  it("detects a running finalise command from command metadata", () => {
    const activity = parseTerminalActivity("2.txt", [
      "---",
      "pid: 456",
      'cwd: "d:\\\\Websites\\\\iommarket"',
      'command: "npm run finalise:full:push"',
      "started_at: 2026-05-19T22:08:57.699Z",
      "running_for_ms: 195257",
      "---",
      "> iommarket@0.1.0 finalise:full:push",
    ].join("\n"));

    expect(activity?.isRunning).toBe(true);
    expect(activity?.isFinalise).toBe(true);
    expect(activity?.startedAt).toBe("2026-05-19T22:08:57.699Z");
  });

  it("does not treat completed finalise output as running", () => {
    const activity = parseTerminalActivity("3.txt", [
      "---",
      "pid: 789",
      'cwd: "d:\\\\Websites\\\\iommarket"',
      'command: "npm run finalise"',
      "started_at: 2026-05-19T22:08:57.699Z",
      "---",
      "Finalise complete.",
      "---",
      "exit_code: 0",
      "elapsed_ms: 1000",
      "---",
    ].join("\n"));

    expect(activity?.isRunning).toBe(false);
    expect(activity?.isFinalise).toBe(true);
  });

  it("ignores a finalise terminal that has just started", () => {
    process.env.CURSOR_TERMINALS_DIR = writeTerminal([
      "---",
      "pid: 999",
      "command: npm run finalise",
      `started_at: ${new Date().toISOString()}`,
      "running_for_ms: 200",
      "---",
      "Starting finalise workflow",
    ].join("\n"));

    expect(() => assertNoBlockingCursorActivity(tmpdir(), [])).not.toThrow();
  });

  it("blocks an older running finalise and any Agent Review", () => {
    process.env.CURSOR_TERMINALS_DIR = writeTerminal([
      "---",
      "pid: 1001",
      "active_command: Agent Review",
      "started_at: 2020-01-01T00:00:00.000Z",
      "---",
      "Reviewing your changes...",
    ].join("\n"));

    expect(() => assertNoBlockingCursorActivity(tmpdir(), [])).toThrow(/Blocking Cursor activity/);
  });
});
