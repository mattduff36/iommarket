import { assertPolicyFlagsValid } from "@/lib/policy/flags";

/**
 * Next.js instrumentation hook – runs once when the server starts,
 * before any request handling or module evaluation.
 *
 * TLS exceptions must remain scoped to the client that needs them. The
 * PostgreSQL pool owns its temporary certificate policy in lib/db/index.ts;
 * changing Node's process-wide policy would also weaken payment, auth, email,
 * and every other outbound HTTPS request.
 */
export function register() {
  assertPolicyFlagsValid();
}
