// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TradeForm } from "@/components/trade/trade-form";

const rethrow = vi.hoisted(() =>
  vi.fn((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
  }),
);

vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => rethrow(error),
}));

function submit(label: string) {
  const form = screen.getByRole("button", { name: label }).closest("form");
  if (!form) throw new Error("Missing form");
  fireEvent.submit(form);
}

describe("TradeForm feedback", () => {
  beforeEach(() => {
    rethrow.mockClear();
  });

  it("shows a success status after a saved result", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <TradeForm action={action} submitLabel="Save decision" successMessage="Decision saved.">
        <input name="note" defaultValue="Checked" />
      </TradeForm>,
    );
    submit("Save decision");
    expect(await screen.findByRole("status")).toHaveTextContent("Decision saved.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledOnce();
  });

  it("shows the returned error and clears a previous success", async () => {
    const action = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ error: "Choose a reason." });
    render(<TradeForm action={action} submitLabel="Save decision"> </TradeForm>);
    submit("Save decision");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    submit("Save decision");
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a reason.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a pending label while the action is in flight", async () => {
    let finish: (value: { ok: true }) => void = () => {};
    const action = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      finish = resolve;
    }));
    render(<TradeForm action={action} submitLabel="Save decision"> </TradeForm>);
    submit("Save decision");
    const pending = await screen.findByRole("button", { name: "Saving…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-disabled", "true");
    finish({ ok: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("shows a recoverable error without the thrown message", async () => {
    const action = vi.fn().mockRejectedValue(new Error("database unavailable"));
    render(<TradeForm action={action} submitLabel="Save decision"> </TradeForm>);
    submit("Save decision");
    expect(await screen.findByRole("alert")).toHaveTextContent("Trade Exchange could not save that. Try again.");
    expect(screen.queryByText("database unavailable")).not.toBeInTheDocument();
    expect(rethrow).toHaveBeenCalledOnce();
  });

  it("rethrows Next navigation instead of showing a form error", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/admin/trade;307",
    });
    const action = vi.fn().mockRejectedValue(redirectError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const caught: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      caught.push(event.error);
      event.preventDefault();
    };
    const onRejection = (reason: unknown) => {
      caught.push(reason);
    };
    window.addEventListener("error", onError);
    process.on("unhandledRejection", onRejection);
    render(<TradeForm action={action} submitLabel="Save decision"> </TradeForm>);
    submit("Save decision");
    await waitFor(() => expect(rethrow).toHaveBeenCalledWith(redirectError));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(caught).toContain(redirectError);
    window.removeEventListener("error", onError);
    process.off("unhandledRejection", onRejection);
    consoleError.mockRestore();
  });
});
