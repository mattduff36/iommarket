import type { Instrumentation } from "next";
import { assertPolicyFlagsValid } from "@/lib/policy/flags";

/**
 * Next.js instrumentation hook – runs once when the server starts,
 * before any request handling or module evaluation.
 *
 * TLS exceptions must remain scoped to the client that needs them. The
 * PostgreSQL pool owns its temporary certificate policy in lib/db/index.ts;
 * changing Node's process-wide policy would also weaken payment, auth, email,
 * and every other outbound HTTPS request.
 *
 * onRequestError must not import Prisma or capture code at top level so Edge
 * evaluation cannot load the Node database client.
 */
export function register() {
  assertPolicyFlagsValid();
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  } else {
    // Next compiles instrumentation once per runtime. This exact documented
    // runtime branch keeps the Node-only module out of the Edge bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { handleNodeRequestError } = require("./instrumentation-node") as typeof import("./instrumentation-node");
    return handleNodeRequestError(error, request, context);
  }
};
