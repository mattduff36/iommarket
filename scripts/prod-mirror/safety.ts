import { SAFETY_ENV_KEYS, WORKSTREAM_ID } from "./constants";
import { assertSourceAndDestRefs } from "./target";

export type MirrorCommand =
  | "backup"
  | "copy-waitlist"
  | "copy-storage"
  | "restore"
  | "rewrite-urls"
  | "verify";

export interface MirrorConfirmations {
  allow: true;
  sourceRef: string;
  destRef: string;
  backupId: string;
  confirmDb: string;
  writersPaused: true;
  command: MirrorCommand;
}

export type SafetyCleared = {
  readonly brand: "prod-mirror-safety";
  readonly workstream: typeof WORKSTREAM_ID;
  readonly confirmations: MirrorConfirmations;
};

const WRITE_COMMANDS = new Set<MirrorCommand>([
  "copy-waitlist",
  "copy-storage",
  "restore",
  "rewrite-urls",
]);

export function isWriteCommand(command: MirrorCommand) {
  return WRITE_COMMANDS.has(command);
}

export function parseArgValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const matched = argv.find((arg) => arg.startsWith(prefix));
  if (!matched) return undefined;
  return matched.slice(prefix.length);
}

export function commandArgv(argv: string[]) {
  return argv.filter((arg) => {
    if (arg.startsWith("--")) return true;
    if (arg.endsWith("node") || arg.endsWith("node.exe")) return false;
    if (arg.includes("prod-mirror")) return false;
    return true;
  });
}

export function parseCommand(argv: string[]): MirrorCommand {
  const command = commandArgv(argv).find((arg) => !arg.startsWith("--"));
  const known: MirrorCommand[] = [
    "backup",
    "copy-waitlist",
    "copy-storage",
    "restore",
    "rewrite-urls",
    "verify",
  ];
  if (!command || !known.includes(command as MirrorCommand)) {
    throw new Error(
      "Refusing mirror: command must be backup | copy-waitlist | copy-storage | restore | rewrite-urls | verify.",
    );
  }
  return command as MirrorCommand;
}

export function parseConfirmationsFromArgv(
  argv: string[],
): Partial<MirrorConfirmations> & { command?: MirrorCommand } {
  const command = commandArgv(argv).some((arg) =>
    ["backup", "copy-waitlist", "copy-storage", "restore", "rewrite-urls", "verify"].includes(arg),
  )
    ? parseCommand(argv)
    : undefined;
  return {
    command,
    allow: parseArgValue(argv, "allow") === "1" ? true : undefined,
    sourceRef: parseArgValue(argv, "source-ref"),
    destRef: parseArgValue(argv, "dest-ref"),
    backupId: parseArgValue(argv, "backup-id"),
    confirmDb: parseArgValue(argv, "confirm-db"),
    writersPaused: parseArgValue(argv, "writers-paused") === "1" ? true : undefined,
  };
}

export function assertNoSafetyKeysInEnvFile(parsed: Record<string, string>) {
  const present = SAFETY_ENV_KEYS.filter((key) => Object.hasOwn(parsed, key));
  if (present.length > 0) {
    throw new Error(
      `Refusing mirror: confirmation keys must be supplied per invocation, not env files (${present.join(", ")}).`,
    );
  }
}

export function assertMirrorSafety(input: {
  argv: string[];
  writeConfirmDb: string;
  backupId: string;
  backupConfirmDb: string;
}): SafetyCleared {
  const parsed = parseConfirmationsFromArgv(input.argv);
  const command = parsed.command;
  if (!command) {
    throw new Error("Refusing mirror: missing command.");
  }
  if (parsed.allow !== true) {
    throw new Error("Refusing mirror: --allow=1 is required.");
  }
  if (!parsed.sourceRef?.trim() || !parsed.destRef?.trim()) {
    throw new Error("Refusing mirror: --source-ref and --dest-ref are required.");
  }
  assertSourceAndDestRefs(parsed.sourceRef, parsed.destRef);

  if (!isWriteCommand(command)) {
    return {
      brand: "prod-mirror-safety",
      workstream: WORKSTREAM_ID,
      confirmations: {
        allow: true,
        sourceRef: parsed.sourceRef,
        destRef: parsed.destRef,
        backupId: parsed.backupId?.trim() || input.backupId,
        confirmDb: parsed.confirmDb?.trim() || input.writeConfirmDb,
        writersPaused: true,
        command,
      },
    };
  }

  if (parsed.writersPaused !== true) {
    throw new Error("Refusing mirror: --writers-paused=1 is required before a write.");
  }
  if (!parsed.backupId?.trim()) {
    throw new Error("Refusing mirror: --backup-id is required before a write.");
  }
  if (!parsed.confirmDb?.trim()) {
    throw new Error("Refusing mirror: --confirm-db is required before a write.");
  }
  if (parsed.backupId !== input.backupId) {
    throw new Error("Refusing mirror: --backup-id does not match dump metadata.");
  }
  if (parsed.confirmDb !== input.backupConfirmDb) {
    throw new Error("Refusing mirror: --confirm-db does not match dump metadata.");
  }
  if (parsed.confirmDb !== input.writeConfirmDb) {
    throw new Error("Refusing mirror: --confirm-db does not match the write destination.");
  }

  return {
    brand: "prod-mirror-safety",
    workstream: WORKSTREAM_ID,
    confirmations: {
      allow: true,
      sourceRef: parsed.sourceRef,
      destRef: parsed.destRef,
      backupId: parsed.backupId,
      confirmDb: parsed.confirmDb,
      writersPaused: true,
      command,
    },
  };
}
