// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthoriseStockComputerButton } from "@/app/(admin)/admin/stock-reviews/authorise-button";

afterEach(cleanup);

it("shows authorisation progress and disables repeat submissions until completion", async () => {
  let finish!: () => void;
  const action = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<form action={action}><AuthoriseStockComputerButton /></form>);
  fireEvent.click(screen.getByRole("button", { name: "Authorise this computer" }));
  expect(screen.getByRole("button", { name: "Authorising computer…" })).toBeDisabled();
  expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button")).toHaveAttribute("data-stock-review-editing", "true");
  fireEvent.click(screen.getByRole("button"));
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(screen.getByRole("button", { name: "Authorise this computer" })).toBeEnabled();
});
