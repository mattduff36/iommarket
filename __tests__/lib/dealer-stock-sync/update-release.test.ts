/* @vitest-environment node */
import { constants, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
import { verifyRelease } from "@/lib/dealer-stock-sync/update-release";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
const release = { version: "1.1.6", channel: "preview", objectKey: "preview/1.1.6/iTrader-Stock-Update-1.1.6.exe", fileName: "iTrader-Stock-Update-1.1.6.exe", size: 100, sha256: "a".repeat(64) };
function envelope(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({ ...release, ...overrides }));
  return { payload: payload.toString("base64"), signature: sign("sha256", payload, { key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString("base64") };
}
describe("installer release trust", () => {
  it("accepts a signed, constrained preview release", () => {
    expect(verifyRelease(envelope(), publicKey).release).toEqual(release);
  });
  it("rejects tampering and untrusted keys", () => {
    const valid = envelope();
    expect(() => verifyRelease({ ...valid, payload: Buffer.from("{}").toString("base64") }, publicKey)).toThrow();
    expect(() => verifyRelease({ ...valid, signature: valid.signature.replace(/^./, "!") }, publicKey)).toThrow();
    expect(() => verifyRelease(valid)).toThrow();
  });
  it.each([{ channel: "production" }, { objectKey: "../other.exe" }, { fileName: "other.exe" }, { version: "1.1.6-beta" }, { size: 0 }, { size: 262144001 }, { sha256: "bad" }])("rejects signed unsafe metadata %j", input => {
    expect(() => verifyRelease(envelope(input), publicKey)).toThrow();
  });
});

it("accepts production only with the expected signed channel and exact path", () => {
  const input = envelope({ channel: "production", objectKey: "production/1.1.6/iTrader-Stock-Update-1.1.6.exe" });
  expect(verifyRelease(input, publicKey, "production").release.channel).toBe("production");
  expect(() => verifyRelease(input, publicKey, "preview")).toThrow();
  expect(() => verifyRelease(envelope(), publicKey, "production")).toThrow();
});
