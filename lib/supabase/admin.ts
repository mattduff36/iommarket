import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isStagingTestRuntime } from "@/lib/deployment/staging-test-effects";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";

type AdminClient = SupabaseClient;

const adminClients = new Map<string, AdminClient>();

function isPreviewSupabaseUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === `${PREVIEW_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

/**
 * Supabase admin client using the service_role key.
 * Only for server-side use - never expose to the browser.
 * Staging identity is checked before any cached client is returned.
 */
export function createSupabaseAdminClient() {
  const staging = isStagingTestRuntime();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for admin client"
    );
  }
  if (staging && !isPreviewSupabaseUrl(url)) {
    throw new Error("Staging admin auth is only available for the verified preview project.");
  }

  const cacheKey = `${url}\0${serviceRoleKey}`;
  const cached = adminClients.get(cacheKey);
  if (cached) return cached;

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  adminClients.set(cacheKey, client);
  return client;
}
