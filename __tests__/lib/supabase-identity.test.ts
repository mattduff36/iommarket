import { describe, expect, it } from "vitest";
import { parsePooledLogin, parseSupabaseConnectionIdentity } from "@/lib/db/supabase-identity";
import { mediaDatabaseIdentity } from "@/lib/media/environment-boundary";

const ref = "syneonzucehwlghqmfbg";
const other = "snlqivvogfqesxpbjiei";

describe("supabase connection identity", () => {
  it("accepts postgres and a bounded custom role on the matching pooler project", () => {
    expect(parsePooledLogin(`postgres.${ref}`)).toEqual({ role: "postgres", projectRef: ref });
    expect(parsePooledLogin(`stock_worker.${ref}`)).toEqual({ role: "stock_worker", projectRef: ref });
    expect(parseSupabaseConnectionIdentity(
      `postgresql://stock_worker.${ref}:fixture@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
    )).toEqual({ kind: "pooler", projectRef: ref, role: "stock_worker" });
    expect(mediaDatabaseIdentity(`postgresql://stock_worker.${ref}@aws-0.pooler.supabase.com/postgres`)).toBe(ref);
  });

  it("rejects malformed logins, foreign projects, and spoofed hosts", () => {
    expect(parsePooledLogin(`.${ref}`)).toBeNull();
    expect(parsePooledLogin(`stock.worker.${ref}`)).toBeNull();
    expect(parsePooledLogin(`stock_worker.${ref}x`)).toBeNull();
    expect(parsePooledLogin(`stock_worker.${other.slice(0, 19)}`)).toBeNull();
    expect(parsePooledLogin(`${"a".repeat(64)}.${ref}`)).toBeNull();
    expect(parsePooledLogin(`stock_worker.%2e${ref}`)).toBeNull();
    expect(parseSupabaseConnectionIdentity(`postgresql://stock_worker.${ref}@db.${ref}.supabase.co.evil.com:5432/postgres`)).toBeNull();
    expect(parseSupabaseConnectionIdentity(`postgresql://stock_worker.${ref}@evil.pooler.supabase.com.attacker.test:5432/postgres`)).toBeNull();
    expect(parseSupabaseConnectionIdentity(`postgresql://postgres.${ref}@aws-0-eu-west-1.pooler.supabase.com:5433/postgres`)).toBeNull();
    expect(parseSupabaseConnectionIdentity(`mysql://stock_worker.${ref}@aws-0.pooler.supabase.com:5432/postgres`)).toBeNull();
    expect(mediaDatabaseIdentity(`postgresql://stock_worker.${other}@aws-0.pooler.supabase.com/postgres`)).toBe(other);
    expect(mediaDatabaseIdentity(`postgresql://stock_worker.${ref}@attacker.example/postgres`)).toBeNull();
  });

  it("keeps direct hosts and loopback separate from the pooler role", () => {
    expect(parseSupabaseConnectionIdentity(`postgresql://postgres:fixture@db.${ref}.supabase.co:5432/postgres`)).toEqual({
      kind: "direct",
      projectRef: ref,
      role: null,
    });
    expect(parseSupabaseConnectionIdentity("postgresql://fixture@127.0.0.1:55439/fixture")).toEqual({
      kind: "loopback",
      projectRef: null,
      role: null,
    });
    expect(mediaDatabaseIdentity("postgresql://fixture@localhost/fixture")).toBe("local");
    expect(parseSupabaseConnectionIdentity("postgresql://fixture@[::1]/fixture")).toBeNull();
  });

  it("rejects malformed percent-encoding in the username", () => {
    expect(parseSupabaseConnectionIdentity(`postgresql://stock_worker%ZZ.${ref}@aws-0.pooler.supabase.com:5432/postgres`)).toBeNull();
    expect(parsePooledLogin("%E0%A4%A")).toBeNull();
  });
});
