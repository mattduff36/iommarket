import { describe, expect, it } from "vitest";
import { explicitlyRevoked, invitationCode } from "@/scripts/stock-update-desktop/oracle-pairing-agent.mjs";
import { oracleSessionFile, oracleTarget } from "@/scripts/stock-update-desktop/oracle-runtime.mjs";
import { DESKTOP_ORIGINS } from "@/scripts/dealer-stock-sync/desktop-access";

const prefix = "Approve this Preview device in your administrator browser: ";
const valid = "https://itrader.dev/admin/stock-worker?code=ABCD2345";

describe("Oracle outbound pairing", () => {
  it("only forwards the short code from the controller's exact Preview link", () => {
    expect(invitationCode(prefix + valid)).toBe("ABCD2345");
    expect(invitationCode("Preview device paired through tomorrow")).toBe(null);
    for (const link of [
      valid.replace("itrader.dev", "itrader.im"),
      valid.replace("/admin/stock-worker", "/admin/other"),
      valid + "&another=field",
      valid + "#fragment",
      valid.replace("ABCD2345", "incorrect"),
    ]) expect(() => invitationCode(prefix + link)).toThrow();
  });

  it("requires the app's explicit rejection before replacing any existing session", async () => {
    expect(await explicitlyRevoked(Response.json({ error: "unauthorized" }, { status: 401 }))).toBe(true);
    for (const result of [
      Response.json({ environment: "preview" }),
      Response.json({ error: "unavailable" }, { status: 503 }),
      Response.json({ error: "forbidden" }, { status: 403 }),
      Response.json({ error: "bad_token" }, { status: 401 }),
      new Response("Sign in", { status: 401, headers: { "content-type": "text/html" } }),
    ]) expect(await explicitlyRevoked(result)).toBe(false);
  });

  it("isolates controller, invitation and storage targets by environment and administrator", () => {
    expect(oracleTarget().environment).toBe("preview");
    const sessionPaths = new Set<string>();
    for (const environment of ["preview", "production"] as const) {
      const target = oracleTarget(environment);
      expect(target.origin).toBe(DESKTOP_ORIGINS[environment]);
      for (const profile of ["admin1", "admin2"]) {
        sessionPaths.add(oracleSessionFile(target, profile));
        expect(oracleSessionFile(target, profile)).toBe(`/var/lib/itrader-stock-${environment}-${profile}/session.json`);
      }
      expect(() => oracleSessionFile(target, "../admin1")).toThrow();
    }
    expect(sessionPaths.size).toBe(4);
    expect(() => oracleTarget("prod")).toThrow();
    const production = oracleTarget("production");
    const productionPrefix = prefix.replace("Preview", "Production");
    expect(invitationCode(productionPrefix + valid.replace("itrader.dev", "itrader.im"), production)).toBe("ABCD2345");
    expect(() => invitationCode(productionPrefix + valid, production)).toThrow();
    expect(invitationCode(prefix + valid, production)).toBeNull();
  });
});
