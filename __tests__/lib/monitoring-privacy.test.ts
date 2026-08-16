import { describe, expect, it } from "vitest";
import {
  redactFreeText,
  redactMonitoringPayload,
  redactStack,
  sanitizeMonitoringContext,
  sanitizeRequestPath,
} from "@/lib/monitoring";

describe("MON-PRIVACY-001 monitoring redaction", () => {
  it("masks emails inside free-form strings", () => {
    expect(redactFreeText("Contact alice@example.com immediately")).toContain(
      "al***@example.com",
    );
    expect(redactFreeText("Contact alice@example.com immediately")).not.toContain(
      "alice@example.com",
    );
  });

  it("redacts bearer tokens, JWTs, cookies, auth headers, and query secrets", () => {
    const input = [
      "Authorization: Bearer super-secret-token",
      "cookie: session=abc123; theme=dark",
      "https://example.com/callback?access_token=tok_123&safe=1",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
    ].join(" ");

    const redacted = redactFreeText(input);
    expect(redacted).toMatch(/Bearer \[redacted\]|authorization=\[redacted\]/);
    expect(redacted).toContain("session=[redacted]");
    expect(redactFreeText("cookie: theme=dark; locale=en-GB")).toContain("theme=[redacted]");
    expect(redactFreeText("cookie: theme=dark; locale=en-GB")).not.toContain("theme=dark");
    expect(redactFreeText("cookie: empty=; theme=dark")).toContain("theme=[redacted]");
    expect(redactFreeText("cookie: empty=; theme=dark")).not.toContain("theme=dark");
    expect(redactFreeText('cookie: note="hello world"; theme=dark')).toContain(
      "theme=[redacted]",
    );
    expect(redactFreeText('cookie: note="hello world"; theme=dark')).not.toContain(
      "theme=dark",
    );
    expect(redactFreeText("cookie: note=hello world; theme=dark")).toContain(
      "theme=[redacted]",
    );
    expect(redactFreeText("cookie: note=hello world; theme=dark")).not.toContain(
      "theme=dark",
    );
    expect(redacted).toContain("access_token=[redacted]");
    expect(redacted).toContain("[redacted-jwt]");
    expect(redacted).not.toContain("super-secret-token");
    expect(redacted).not.toContain("tok_123");
  });

  it("redacts stacks, paths, tags, extra fields, and console-like args", () => {
    const stack = redactStack(
      "Error: boom for bob@example.com\n    at run (https://app.example/x?token=abc)",
    );
    expect(stack).toContain("bo***@example.com");
    expect(stack).toContain("token=[redacted]");

    expect(sanitizeRequestPath("/account?access_token=secret#hash")).toBe(
      "/account?access_token=[redacted]",
    );

    const payload = redactMonitoringPayload({
      extra: {
        consoleArgs: ["failed for carol@example.com", { cookie: "sid=xyz" }],
      },
      tags: {
        authorization: "Bearer abc",
        note: "reset?api_key=abcd",
      },
    });

    expect(payload).toMatchObject({
      extra: {
        consoleArgs: [
          "failed for ca***@example.com",
          { cookie: "[redacted]" },
        ],
      },
      tags: {
        authorization: "[redacted]",
        note: "reset?api_key=[redacted]",
      },
    });
  });

  it("sanitizes every free-form context field at the persistence boundary", () => {
    expect(
      sanitizeMonitoringContext({
        title: "Failed for alice@example.com",
        environment: "preview alice@example.com",
        route: "/callback?token=secret",
        action: "send bearer abc.def",
        component: "Account alice@example.com",
        requestMethod: "POST authorization=private",
        requestPath: "https://app.example/callback?access_token=secret",
        requestId: "authorization=private",
        userId: "user alice@example.com",
        userEmail: "alice@example.com",
        ipHash: "hash bearer abc.def",
        tags: { cookie: "session=secret" },
        extra: { callback: "/done?api_key=secret" },
      }),
    ).toMatchObject({
      title: "Failed for al***@example.com",
      environment: "preview al***@example.com",
      route: "/callback?token=[redacted]",
      action: "send Bearer [redacted]",
      component: "Account al***@example.com",
      requestMethod: "POST authorization=[redacted]",
      requestPath: "/callback?access_token=[redacted]",
      requestId: "authorization=[redacted]",
      userId: "user al***@example.com",
      userEmail: "al***@example.com",
      ipHash: "hash Bearer [redacted]",
      tags: { cookie: "[redacted]" },
      extra: { callback: "/done?api_key=[redacted]" },
    });
  });
});
