/**
 * Next.js instrumentation hook – runs once when the server starts,
 * before any request handling or module evaluation.
 *
 * We disable TLS certificate verification here so the pg driver
 * can connect to Supabase's pooler whose certificate chain includes
 * a root CA not in Node's default trust store.
 *
 * TODO: Replace with Supabase root CA pinning for production hardening.
 */
export async function register() {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}
