const IGNORED_CONSOLE_PATTERNS = [
  /^warning:/i,
  /%c/,
  /download the react devtools/i,
  /fast refresh/i,
  /hydration failed/i,
  /authsessionmissingerror/i,
  /_usesession|_getuser/i,
  /failed to log (error|monitoring)/i,
  /error fetching error logs/i,
  /\/api\/monitoring\/events/i,
  /monitoring should never crash/i,
];

export function serializeConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg === null) return "null";
      if (arg === undefined) return "undefined";
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === "object") {
        try {
          const keys = Object.keys(arg as object);
          if (keys.length === 0) return "{}";
          const asRecord = arg as { message?: string; name?: string };
          if ("message" in asRecord || "name" in asRecord) {
            return `${asRecord.name || "Error"}: ${asRecord.message || "Unknown error"}`;
          }
          const stringified = JSON.stringify(arg);
          return stringified === "{}" ? "[Empty Object]" : stringified;
        } catch {
          return "[Object]";
        }
      }
      return String(arg);
    })
    .join(" ")
    .trim();
}

export function shouldIgnoreConsoleError(message: string): boolean {
  const trimmed = message.trim();
  if (
    trimmed === "" ||
    trimmed === "{}" ||
    trimmed === "[Empty Object]" ||
    trimmed === "[object Object]" ||
    trimmed === "undefined" ||
    trimmed === "null"
  ) {
    return true;
  }

  return IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isExpectedClientCancellation(reason: unknown): boolean {
  if (
    reason !== null &&
    typeof reason === "object" &&
    "name" in reason &&
    reason.name === "AbortError"
  ) {
    return true;
  }

  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";

  return /\b(?:signal is aborted|aborted without reason|operation was aborted)\b/i.test(
    message,
  );
}

export function extractConsoleStack(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (arg instanceof Error && arg.stack) return arg.stack;
  }
  return undefined;
}
