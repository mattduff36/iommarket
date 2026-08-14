import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveChecklistMock } = vi.hoisted(() => ({
  saveChecklistMock: vi.fn(),
}));

vi.mock("@/actions/admin/checklist", () => ({
  saveChecklist: saveChecklistMock,
}));

import { ChecklistBoard } from "@/app/(admin)/admin/checklist/checklist-board";
import { createChecklistItem } from "@/lib/admin/checklist";

const NOW = new Date("2026-08-14T21:00:00.000Z");

function renderBoard() {
  return render(
    <ChecklistBoard
      initialItems={[
        createChecklistItem(
          { id: "seed-gdpr-advice", title: "GDPR advice" },
          NOW,
        ),
        createChecklistItem(
          {
            id: "seed-website-terms",
            title: "Website T&Cs — avoid being an agent",
            notes: "Draft terms and conditions for the website.",
            label: "DM",
          },
          new Date(NOW.getTime() + 1),
        ),
      ]}
    />,
  );
}

describe("ChecklistBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveChecklistMock.mockResolvedValue({ data: { saved: true } });
  });

  it("toggles an item complete and persists the updated list", async () => {
    renderBoard();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mark GDPR advice as done" }),
    );

    await waitFor(() => {
      expect(saveChecklistMock).toHaveBeenCalledWith({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "seed-gdpr-advice",
            done: true,
          }),
        ]),
      });
    });
  });

  it("adds a new item from the composer", async () => {
    renderBoard();

    fireEvent.change(screen.getByRole("textbox", { name: "New checklist item" }), {
      target: { value: "Follow up with insurers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByDisplayValue("Follow up with insurers")).toBeTruthy();
    await waitFor(() => {
      expect(saveChecklistMock).toHaveBeenCalledWith({
        items: expect.arrayContaining([
          expect.objectContaining({
            title: "Follow up with insurers",
            done: false,
          }),
        ]),
      });
    });
  });

  it("shows notes when an item is expanded", () => {
    renderBoard();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show notes for Website T&Cs — avoid being an agent",
      }),
    );

    expect(
      screen.getByRole("textbox", {
        name: "Notes for Website T&Cs — avoid being an agent",
      }),
    ).toHaveValue("Draft terms and conditions for the website.");
  });
});
