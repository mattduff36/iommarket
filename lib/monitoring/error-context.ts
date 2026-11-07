type ErrorFacts = {
  stage: string; durationMs?: number; databaseCode?: string;
  sameIdentityFound?: boolean; retryAttempted?: boolean;
};
const facts = new WeakMap<object, ErrorFacts>();

/** Operation-owned facts only. No user IDs, addresses, queries or credentials. */
export function rememberErrorFacts(error: unknown, value: ErrorFacts): void {
  if (error && typeof error === "object") facts.set(error, { ...value });
}

export function readErrorFacts(error: unknown): ErrorFacts | undefined {
  if (!error || typeof error !== "object") return undefined;
  const own = facts.get(error);
  if (own) return { ...own };
  const cause = "cause" in error ? error.cause : null;
  return cause && typeof cause === "object" ? facts.get(cause) : undefined;
}
