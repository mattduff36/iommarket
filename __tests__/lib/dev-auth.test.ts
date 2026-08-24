import { describe, expect, it } from "vitest";
import { decideDevAuth, isHttpUrl, passwordsMatch } from "@/lib/dev-auth";

const env = {
  devPass: "dev-secret",
  previewPass: "preview-secret",
  previewUrl: "https://preview.example.com/app",
};

describe("passwordsMatch", () => {
  it("matches identical strings", () => {
    expect(passwordsMatch("abc", "abc")).toBe(true);
  });

  it("rejects different strings and lengths", () => {
    expect(passwordsMatch("abc", "abd")).toBe(false);
    expect(passwordsMatch("ab", "abc")).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https absolute URLs", () => {
    expect(isHttpUrl("https://preview.example.com")).toBe(true);
    expect(isHttpUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects non-http schemes and relative paths", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("/preview")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("decideDevAuth", () => {
  it("keeps the existing not-configured result when DEV_PASS is missing", () => {
    expect(decideDevAuth("anything", { ...env, devPass: undefined })).toEqual({
      kind: "not_configured",
    });
  });

  it("keeps the existing not-configured result for a non-string password", () => {
    expect(decideDevAuth(null, env)).toEqual({ kind: "not_configured" });
    expect(decideDevAuth(123, env)).toEqual({ kind: "not_configured" });
  });

  it("unlocks the site for DEV_PASS", () => {
    expect(decideDevAuth("dev-secret", env)).toEqual({ kind: "dev" });
  });

  it("prefers DEV_PASS when both passwords are the same", () => {
    expect(
      decideDevAuth("shared", {
        devPass: "shared",
        previewPass: "shared",
        previewUrl: env.previewUrl,
      }),
    ).toEqual({ kind: "dev" });
  });

  it("redirects to PREVIEW_URL for PREVIEW_PASS", () => {
    expect(decideDevAuth("preview-secret", env)).toEqual({
      kind: "preview",
      redirect: env.previewUrl,
    });
  });

  it("rejects PREVIEW_PASS when PREVIEW_URL is missing or unsafe", () => {
    expect(
      decideDevAuth("preview-secret", { ...env, previewUrl: undefined }),
    ).toEqual({ kind: "unauthorized" });
    expect(
      decideDevAuth("preview-secret", {
        ...env,
        previewUrl: "javascript:alert(1)",
      }),
    ).toEqual({ kind: "unauthorized" });
  });

  it("rejects an unknown password", () => {
    expect(decideDevAuth("wrong-password", env)).toEqual({
      kind: "unauthorized",
    });
  });

  it("does not treat an empty PREVIEW_PASS as configured", () => {
    expect(
      decideDevAuth("", {
        ...env,
        previewPass: "",
      }),
    ).toEqual({ kind: "unauthorized" });
  });
});
