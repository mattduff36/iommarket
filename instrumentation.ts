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
 * evaluation cannot load the Node database client. The runtime split uses the
 * dynamic import shown by the installed Next.js instrumentation guide.
 */
export function register() {
  assertPolicyFlagsValid();
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "edge") {
    const message = error instanceof Error ? error.message : "Unknown edge error";
    const path = request.path.split("?")[0]?.slice(0, 300) ?? "/";
    console.error(JSON.stringify({
      monitoringFallback: true,
      kind: "edge-request-error",
      message: message.slice(0, 300),
      path,
    }));
    return;
  }

  const imported = await import("./instrumentation-node");
  const handle = imported.handleNodeRequestError;
  if (typeof handle !== "function") {
    console.error(JSON.stringify({
      monitoringFallback: true,
      kind: "instrumentation-handler-missing",
    }));
    return;
  }
  await handle(error, request, context);
};
