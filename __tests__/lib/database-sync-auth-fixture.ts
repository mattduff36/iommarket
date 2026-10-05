import { AUTH_EXPORT_COLUMNS } from "@/lib/database-sync/auth-export-contract";
import { AUTH_TOKEN_COLUMNS } from "@/lib/database-sync/auth-clone";
import { quoteIdent } from "@/lib/database-sync/codec";

/** Match the observed production Auth column order/types, including generated fields. */
export function authFixtureSql(): string {
  const users = AUTH_EXPORT_COLUMNS.users.map((column) => {
    let suffix = "";
    if (column.name === "id") suffix = " PRIMARY KEY";
    if (column.name === "encrypted_password" || (AUTH_TOKEN_COLUMNS as readonly string[]).includes(column.name)) suffix = " NOT NULL DEFAULT ''";
    if (column.name === "confirmed_at") suffix = " GENERATED ALWAYS AS (LEAST(email_confirmed_at,phone_confirmed_at)) STORED";
    return `${quoteIdent(column.name)} ${column.type}${suffix}`;
  });
  const identities = AUTH_EXPORT_COLUMNS.identities.map((column) => {
    let suffix = "";
    if (column.name === "id") suffix = " PRIMARY KEY DEFAULT gen_random_uuid()";
    if (column.name === "user_id") suffix = " NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE";
    if (column.name === "provider_id" || column.name === "provider") suffix = " NOT NULL";
    if (column.name === "email") suffix = " GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED";
    return `${quoteIdent(column.name)} ${column.type}${suffix}`;
  });
  // FK checks run as the owning Auth role, which needs its own schema access.
  // This grant belongs only to the disposable fixture, never the runtime reader.
  return `CREATE SCHEMA auth AUTHORIZATION supabase_admin;
    GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;
    CREATE TABLE auth.users (${users.join(",")});
    CREATE TABLE auth.identities (${identities.join(",")}, UNIQUE(provider_id, provider));
    ALTER TABLE auth.users OWNER TO supabase_auth_admin;
    ALTER TABLE auth.identities OWNER TO supabase_auth_admin;`;
}
