import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFromEmail, sendResendEmail } from "@/lib/email/client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sendResendEmail recipients", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "iTrader <notify@itrader.im>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: "email_1" })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops example.com recipients before calling Resend", async () => {
    await sendResendEmail({
      to: ["seed@example.com", "buyer@itrader.im"],
      subject: "Listing enquiry",
      text: "Hello",
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.to).toEqual(["buyer@itrader.im"]);
  });

  it("defaults to the verified iTrader sender when no sender env is set", () => {
    delete process.env.RESEND_FROM_EMAIL;

    expect(getFromEmail()).toBe("iTrader <no-reply@itrader.im>");
  });

  it("does not call Resend when every recipient is example.com", async () => {
    await sendResendEmail({
      to: "preview@example.com",
      subject: "Seed",
      text: "Hello",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("still throws when a real recipient is rejected", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          message: "Recipient address was rejected.",
          name: "validation_error",
          statusCode: 403,
        },
        403,
      ),
    );

    await expect(
      sendResendEmail({
        to: "ops@itrader.im",
        subject: "Alert",
        text: "Hello",
      }),
    ).rejects.toThrow("Recipient address was rejected.");
  });
});
