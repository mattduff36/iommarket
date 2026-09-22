import { KEEP_ACCOUNT_EMAILS, DELETE_AUTH_EMAILS } from "../wipe-preview-marketplace/target";

function normalize(email: string) {
  return email.trim().toLowerCase();
}

function sameRoster(actual: string[], expected: readonly string[]) {
  const left = [...actual.map(normalize)].sort();
  const right = [...expected].map(normalize).sort();
  return (
    left.length === right.length && left.every((email, index) => email === right[index])
  );
}

export function assertApprovedAuthDeletion(input: {
  snapshotDeleteEmails: readonly string[];
  requestedEmails: readonly string[];
}) {
  if (!sameRoster([...input.requestedEmails], input.snapshotDeleteEmails)) {
    throw new Error("Refusing Auth delete: roster is not the confirmed snapshot list.");
  }
  const keep = new Set<string>(KEEP_ACCOUNT_EMAILS);
  if (input.requestedEmails.some((email) => keep.has(normalize(email)))) {
    throw new Error("Refusing Auth delete: keep-list email is on the deletion roster.");
  }
}

export function resolveAuthUsersToDelete(
  users: Array<{ id: string; email: string }>,
  emails: readonly string[],
) {
  assertApprovedAuthDeletion({
    snapshotDeleteEmails: emails,
    requestedEmails: emails,
  });
  return emails.flatMap((email) => {
    const matches = users.filter(
      (user) => user.email.trim().toLowerCase() === email.trim().toLowerCase(),
    );
    if (matches.length === 0) return [];
    if (matches.length !== 1) {
      throw new Error(`Auth delete roster mismatch for ${email}.`);
    }
    return [matches[0]];
  });
}

export function plannedAuthDeletions(authEmails: readonly string[]) {
  const present = new Set(authEmails.map(normalize));
  const keep = new Set<string>(KEEP_ACCOUNT_EMAILS);
  if ([...keep].some((email) => !present.has(email))) {
    throw new Error(`Auth keep-list missing: ${KEEP_ACCOUNT_EMAILS.join(", ")}`);
  }
  const unexpected = [...present].filter(
    (email) => !keep.has(email) && !DELETE_AUTH_EMAILS.includes(email as (typeof DELETE_AUTH_EMAILS)[number]),
  );
  if (unexpected.length > 0) {
    throw new Error(`Unexpected Auth users: ${unexpected.join(", ")}`);
  }
  return DELETE_AUTH_EMAILS.filter((email) => present.has(email));
}

export function assertRetainedAuthRoster(authEmails: readonly string[]) {
  if (!sameRoster([...authEmails], KEEP_ACCOUNT_EMAILS)) {
    throw new Error(
      `Auth roster must be exactly ${KEEP_ACCOUNT_EMAILS.join(", ")}.`,
    );
  }
}
