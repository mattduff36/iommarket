import { FOUNDING_GRANT_DAYS } from "./allowlist";

export { FOUNDING_GRANT_DAYS };

export interface FoundingSubscriptionRow {
  source: string;
  status: string;
  grantStartsAt: Date | null;
  grantEndsAt: Date | null;
}

export function plannedGrantWindow(now: Date) {
  return {
    startsAt: now,
    endsAt: new Date(now.getTime() + FOUNDING_GRANT_DAYS * 86_400_000),
  };
}

export function resolveFoundingGrant(input: {
  subscriptions: FoundingSubscriptionRow[];
  now: Date;
}): { kind: "create" | "preserve"; startsAt: Date; endsAt: Date } {
  if (input.subscriptions.some((row) => row.source === "PAYMENT")) {
    throw new Error("Refusing founding onboard: paid subscription already exists.");
  }
  if (input.subscriptions.length === 0) {
    return { kind: "create", ...plannedGrantWindow(input.now) };
  }
  if (input.subscriptions.length !== 1) {
    throw new Error("Refusing founding onboard: unexpected existing grant.");
  }
  const existing = input.subscriptions[0]!;
  if (
    existing.source !== "ADMIN_GRANT" ||
    existing.status !== "ACTIVE" ||
    !existing.grantStartsAt ||
    !existing.grantEndsAt ||
    existing.grantEndsAt.getTime() <= existing.grantStartsAt.getTime() ||
    existing.grantEndsAt.getTime() <= input.now.getTime()
  ) {
    throw new Error("Refusing founding onboard: unexpected existing grant.");
  }
  return {
    kind: "preserve",
    startsAt: existing.grantStartsAt,
    endsAt: existing.grantEndsAt,
  };
}
