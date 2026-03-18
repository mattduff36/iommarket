const SENSITIVE_KEY_REGEX =
  /(password|token|secret|authorization|cookie|api[_-]?key|signature|webhook)/i;

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 4000;

function maskEmail(input: string): string {
  const parts = input.split("@");
  if (parts.length !== 2) return input;
  const [local, domain] = parts;
  if (local.length <= 2) return `**@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function redactStringValue(value: string): string {
  let result = value.trim();
  if (result.length > MAX_STRING_LENGTH) {
    result = `${result.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result)) {
    return maskEmail(result);
  }

  return result;
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactStringValue(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactUnknown(item, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactUnknown(nested, depth + 1);
      }
    }

    return out;
  }

  return String(value);
}

export function redactMonitoringPayload(
  payload: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  return redactUnknown(payload, 0) as Record<string, unknown>;
}

export function redactStack(stack?: string | null): string | null {
  if (!stack) return null;
  return stack
    .split("\n")
    .slice(0, 40)
    .map((line) => line.slice(0, 500))
    .join("\n");
}
