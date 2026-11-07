// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminListingEditButton } from "@/components/admin/listing-edit-button";

vi.mock("@/components/admin/listing-edit-dialog", () => ({
  ListingEditDialog: ({ listingId, onOpenChange, onSaved }: { listingId: string; onOpenChange: (open: boolean) => void; onSaved?: () => void }) =>
    <div role="dialog" aria-label={`Edit ${listingId}`}>
      <button onClick={() => { onSaved?.(); onOpenChange(false); }}>Save fixture</button>
    </div>,
}));
afterEach(cleanup);

it("opens the admin editor directly and refreshes the stock review after saving", async () => {
  const saved = vi.fn();
  render(<AdminListingEditButton listingId="pending-listing" label="Edit / override" onSaved={saved} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit / override" }));
  expect(await screen.findByRole("dialog", { name: "Edit pending-listing" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save fixture" }));
  expect(saved).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
