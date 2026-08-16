import { PLACEHOLDER_AUTH_RE } from "./constants";

export interface PreservedIdentity {
  id: string;
  authUserId: string;
  email: string;
  role: string;
}

export function isPlaceholderAuthUserId(authUserId: string) {
  return PLACEHOLDER_AUTH_RE.test(authUserId);
}

export function isPreservedAuthUserId(authUserId: string) {
  return !isPlaceholderAuthUserId(authUserId);
}

export function comparePreservedIdentities(
  expected: readonly PreservedIdentity[],
  actual: readonly PreservedIdentity[],
) {
  if (expected.length !== actual.length) {
    throw new Error(
      `Preserved identity count changed: expected ${expected.length}, found ${actual.length}.`,
    );
  }

  const actualById = new Map(actual.map((row) => [row.id, row]));
  for (const snapshot of expected) {
    const row = actualById.get(snapshot.id);
    if (!row) {
      throw new Error(`Preserved user ${snapshot.id} is missing.`);
    }
    if (
      row.authUserId !== snapshot.authUserId ||
      row.email !== snapshot.email ||
      row.role !== snapshot.role
    ) {
      throw new Error(`Preserved identity changed for ${snapshot.id}.`);
    }
  }
}
