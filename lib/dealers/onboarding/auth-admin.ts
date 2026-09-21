import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertSupabaseActionLink } from "@/lib/dealers/onboarding/recovery-link";
import { ONBOARDING_SESSION_INVALID_BEFORE } from "@/lib/dealers/onboarding/session-cutoff";

const MAX_AUTH_PAGES = 20;
const AUTH_PAGE_SIZE = 200;

export interface AuthUserMatch {
  id: string;
  email: string | null;
}

export async function findAuthUserByEmail(email: string): Promise<AuthUserMatch | null> {
  const admin = createSupabaseAdminClient();
  const needle = email.trim().toLowerCase();
  for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    });
    if (error) {
      throw new Error("Unable to confirm that email is available.");
    }
    const users = data.users ?? [];
    const match = users.find((user) => (user.email ?? "").trim().toLowerCase() === needle);
    if (match) return { id: match.id, email: match.email ?? null };
    if (users.length < AUTH_PAGE_SIZE) return null;
  }
  throw new Error("Unable to confirm that email is available.");
}

export async function generateDealerRecoveryLink(input: {
  email: string;
  redirectTo: string;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Authentication is not configured.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: input.email,
    options: { redirectTo: input.redirectTo },
  });
  if (error || !data.properties?.action_link || !data.user?.id) {
    throw new Error("Unable to start secure account claim.");
  }
  return {
    actionLink: assertSupabaseActionLink(data.properties.action_link, supabaseUrl),
    authUserId: data.user.id,
  };
}

export async function updateAuthUserEmail(input: { authUserId: string; email: string }) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.updateUserById(input.authUserId, {
    email: input.email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Unable to update the account email.");
  }
  return { id: data.user.id, email: data.user.email ?? "" };
}

export async function revokeAuthUserSessions(accessToken: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.signOut(accessToken, "global");
  if (error) throw new Error("Unable to finish signing out the old session.");
}

export async function invalidateDealerAuthSessions(authUserId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(authUserId)) {
    throw new Error("Unable to revoke the dealer session.");
  }
  const admin = createSupabaseAdminClient();
  const existing = await admin.auth.admin.getUserById(authUserId);
  if (existing.error || !existing.data.user) {
    throw new Error("Unable to revoke the dealer session.");
  }
  const invalidBefore = Math.floor(Date.now() / 1000);
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    app_metadata: {
      ...(existing.data.user.app_metadata ?? {}),
      [ONBOARDING_SESSION_INVALID_BEFORE]: invalidBefore,
    },
  });
  if (error) throw new Error("Unable to revoke the dealer session.");

  await deleteAuthRows(Prisma.sql`DELETE FROM auth.sessions WHERE user_id = CAST(${authUserId} AS uuid)`);
  await deleteAuthRows(Prisma.sql`DELETE FROM auth.refresh_tokens WHERE user_id = ${authUserId}`);
  await deleteAuthRows(Prisma.sql`DELETE FROM auth.one_time_tokens WHERE user_id = CAST(${authUserId} AS uuid)`);
}

async function deleteAuthRows(query: Prisma.Sql) {
  try {
    await db.$executeRaw(query);
  } catch (error) {
    if (isMissingAuthRelation(error)) return;
    throw new Error("Unable to revoke the dealer session.");
  }
}

function isMissingAuthRelation(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
    return String(error.meta?.code) === "42P01";
  }
  return error instanceof Error && error.message.toLowerCase().includes("does not exist");
}
