import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seal, unseal, verifySealed } from "@/lib/database-sync/store";
const env = { NODE_ENV: "test", DATABASE_SYNC_ENCRYPTION_KEY: randomBytes(32).toString("hex") } as NodeJS.ProcessEnv;

describe("database sync encrypted snapshots", () => {
  it("round trips backup data and uses a fresh authenticated nonce for each encryption", () => {
    const value = { rows: [{ id: "test-record", amount: "123.45" }], protection: ["admin"] };
    const first = seal(value, "run-a", env);
    expect(first).not.toEqual(seal(value, "run-a", env));
    expect(unseal(first, "run-a", env)).toEqual(value);
    expect(() => verifySealed(value, first, "run-a", env)).not.toThrow();
    expect(() => verifySealed({ rows: [] }, first, "run-a", env)).toThrow("Backup verification failed");
  });
  it("rejects ciphertext tampering, another run id and another encryption key", () => {
    const sealed = seal({ rows: ["private"] }, "run-a", env);
    const parts = sealed.split(".");
    const ciphertext = Buffer.from(parts[3], "base64");
    ciphertext[0] ^= 1;
    parts[3] = ciphertext.toString("base64");
    for (const [raw, id, keyEnv] of [
      [parts.join("."), "run-a", env], [sealed, "run-b", env],
      [sealed, "run-a", { ...env, DATABASE_SYNC_ENCRYPTION_KEY: randomBytes(32).toString("hex") }],
    ] as const) expect(() => unseal(raw, id, keyEnv)).toThrow("encrypted backup could not be verified");
  });
  it("fails closed on malformed envelopes and missing keys without echoing their values", () => {
    for (const raw of ["", "v2.a.b.c", "v1.a.b.c.extra", "v1.a.b.c"]) {
      expect(() => unseal(raw, "run", env)).toThrow("encrypted backup could not be verified");
    }
    expect(() => seal({}, "run", { NODE_ENV: "test" })).toThrow("encryption key is not configured");
  });
});
