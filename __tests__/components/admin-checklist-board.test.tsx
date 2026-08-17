import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveChecklistMock, updateChecklistCompletionMock } = vi.hoisted(() => ({
  saveChecklistMock: vi.fn(),
  updateChecklistCompletionMock: vi.fn(),
}));

vi.mock("@/actions/admin/checklist", () => ({
  saveChecklist: saveChecklistMock,
  updateChecklistCompletion: updateChecklistCompletionMock,
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
            labels: ["DM"],
          },
          new Date(NOW.getTime() + 1),
        ),
      ]}
      initialUpdatedAt="2026-08-14T21:05:00.000Z"
    />,
  );
}

describe("ChecklistBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveChecklistMock.mockImplementation(async (input) => ({
      data: {
        saved: true,
        items: input.items,
        updatedAt: "2026-08-14T21:06:00.000Z",
      },
    }));
    updateChecklistCompletionMock.mockImplementation(async (input) => ({
      data: {
        items: [
          createChecklistItem(
            {
              id: "seed-gdpr-advice",
              title: "GDPR advice",
              done: input.done,
            },
            NOW,
          ),
          createChecklistItem(
            {
              id: "seed-website-terms",
              title: "Website T&Cs — avoid being an agent",
              notes: "Draft terms and conditions for the website.",
              labels: ["DM"],
            },
            new Date(NOW.getTime() + 1),
          ),
        ],
        updatedAt: "2026-08-14T21:06:00.000Z",
      },
    }));
  });

  it("toggles an item complete and persists the updated list", async () => {
    renderBoard();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mark GDPR advice as done" }),
    );

    await waitFor(() => {
      expect(updateChecklistCompletionMock).toHaveBeenCalledWith({
        itemId: "seed-gdpr-advice",
        done: true,
        expectedUpdatedAt: "2026-08-14T21:05:00.000Z",
        expectedItemUpdatedAt: NOW.toISOString(),
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
            labels: [],
          }),
        ]),
        expectedUpdatedAt: "2026-08-14T21:05:00.000Z",
      });
    });
  });

  it("assigns both DM and MD when both are selected", async () => {
    renderBoard();

    fireEvent.click(screen.getByRole("checkbox", { name: "Assign to DM" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Assign to MD" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New checklist item" }), {
      target: { value: "Shared follow-up" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() => {
      expect(saveChecklistMock).toHaveBeenCalledWith({
        items: expect.arrayContaining([
          expect.objectContaining({
            title: "Shared follow-up",
            labels: ["DM", "MD"],
          }),
        ]),
        expectedUpdatedAt: "2026-08-14T21:05:00.000Z",
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

  it("persists a changed title against the saved baseline", async () => {
    renderBoard();
    const title = screen.getByRole("textbox", {
      name: "Title for GDPR advice",
    });

    fireEvent.change(title, { target: { value: "Updated GDPR advice" } });
    fireEvent.blur(title);

    await waitFor(() => {
      expect(saveChecklistMock).toHaveBeenCalledWith({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "seed-gdpr-advice",
            title: "Updated GDPR advice",
          }),
        ]),
        expectedUpdatedAt: "2026-08-14T21:05:00.000Z",
      });
    });
  });

  it("rolls back title and notes when a save conflicts", async () => {
    saveChecklistMock.mockResolvedValue({
      error: "The checklist changed in another session. Refresh and try again.",
    });
    renderBoard();

    const title = screen.getByRole("textbox", {
      name: "Title for GDPR advice",
    });
    fireEvent.change(title, { target: { value: "Conflicting title" } });
    fireEvent.blur(title);
    await waitFor(() => {
      expect(screen.getByDisplayValue("GDPR advice")).toBeInTheDocument();
    });

    const showNotes = screen.getByRole("button", {
      name: "Show notes for Website T&Cs — avoid being an agent",
    });
    await waitFor(() => expect(showNotes).toBeEnabled());
    fireEvent.click(showNotes);
    const notes = screen.getByRole("textbox", {
      name: "Notes for Website T&Cs — avoid being an agent",
    });
    fireEvent.change(notes, { target: { value: "Conflicting notes" } });
    fireEvent.blur(notes);
    await waitFor(() => {
      expect(notes).toHaveValue(
        "Draft terms and conditions for the website.",
      );
    });
  });

  it("rolls back add and remove operations when a save conflicts", async () => {
    saveChecklistMock.mockResolvedValue({
      error: "The checklist changed in another session. Refresh and try again.",
    });
    renderBoard();

    const composer = screen.getByRole("textbox", {
      name: "New checklist item",
    });
    fireEvent.change(composer, { target: { value: "Conflicting addition" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await waitFor(() => {
      expect(composer).toHaveValue("Conflicting addition");
      expect(
        screen.queryByDisplayValue("Conflicting addition"),
      ).toBe(composer);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Delete GDPR advice" }),
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("GDPR advice")).toBeInTheDocument();
    });
  });
});
