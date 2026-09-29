// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
}));

vi.mock("@/actions/dealer/correspondence", () => ({
  verifyDealerCorrespondenceEmail: verifyMock,
}));

import ConfirmCorrespondencePage from "@/app/(public)/dealer/correspondence/verify/page";

describe("ConfirmCorrespondencePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not confirm an address just by opening the link", async () => {
    const user = userEvent.setup();
    const token = "a".repeat(43);
    render(await ConfirmCorrespondencePage({ searchParams: Promise.resolve({ token }) }));

    expect(verifyMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm this email address" })).toBeTruthy();

    verifyMock.mockResolvedValue({ data: { verifiedEmail: "sales@dealer.example" } });
    await user.click(screen.getByRole("button", { name: "Confirm this email address" }));

    expect(verifyMock).toHaveBeenCalledWith({ token });
    expect(screen.getByText(/sales@dealer.example is confirmed/i)).toBeTruthy();
  });

  it("shows an invalid link without a confirmation action", async () => {
    render(await ConfirmCorrespondencePage({ searchParams: Promise.resolve({ token: "short" }) }));

    expect(screen.getByText(/confirmation link is not valid/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm this email address" })).toBeNull();
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
