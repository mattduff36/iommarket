import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { writeFileSync } from "node:fs";
const DEVELOPMENT_ADMIN_EMAIL = "admin@mpdee.co.uk";

const DEV_PROJECT = "syneonzucehwlghqmfbg";
const PRODUCTION_PROJECT = "snlqivvogfqesxpbjiei";

function assertDevelopmentAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(DEV_PROJECT) || url.includes(PRODUCTION_PROJECT)) {
    throw new Error("Refusing to create a session outside the development auth project.");
  }
  return url;
}

async function sessionForAdmin() {
  const url = assertDevelopmentAuth();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey || !serviceKey) throw new Error("Development auth keys are missing.");

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: DEVELOPMENT_ADMIN_EMAIL });
  if (link.error || !link.data.properties?.hashed_token) {
    throw new Error(link.error?.message ?? "Development admin magic link was not issued.");
  }
  console.log(JSON.stringify({
    linkProperties: Object.keys(link.data.properties),
    verificationType: link.data.properties.verification_type ?? null,
  }));
  const verified = await anon.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "email",
  });
  if (verified.error || !verified.data.session) {
    throw new Error(verified.error?.message ?? "Development admin session was not created.");
  }
  return verified.data.session;
}

async function main() {
  const session = await sessionForAdmin();
  const url = assertDevelopmentAuth();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookies.map(({ name, value }) => ({ name, value })),
      setAll: (next: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
        cookies.splice(0, cookies.length, ...next);
      },
    },
  });
  const stored = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (stored.error) throw new Error(stored.error.message);
  writeFileSync("tmp/imagekit-admin-cookies.json", JSON.stringify(cookies), { mode: 0o600 });
  console.log(JSON.stringify({
    cookies: cookies.map((cookie) => cookie.name),
    session: true,
  }));
}

main();
