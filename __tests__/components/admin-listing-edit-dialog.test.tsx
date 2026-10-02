// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingEditDialog } from "@/components/admin/listing-edit-dialog";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  onOpenChange: vi.fn(),
  onSaved: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/actions/admin/listing-edit", () => ({
  loadAdminListingForEdit: mocks.load,
  saveAdminListingEdit: mocks.save,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean; onOpenChange?: (open: boolean) => void }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section role="dialog">{children}</section>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const loadData = {
  listing: {
    id: "listing-1",
    title: "Island runabout",
    description: "A well cared for boat with a detailed history.",
    price: 250000,
    status: "LIVE",
    categoryId: "category-1",
    regionId: "region-1",
    lifecycleRevision: 3,
    updatedAt: "2026-09-30T10:00:00.000Z",
    attributes: [],
    photoCount: 4,
  },
  categories: [{ id: "category-1", name: "Boats", slug: "boats", attributes: [] }],
  regions: [{ id: "region-1", name: "Douglas", active: true }],
  hasOpenRevision: false,
  openRevisionStatus: null,
};

describe("ListingEditDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue({ data: loadData });
  });

  it("loads fresh details and makes the public effect and photo boundary explicit", async () => {
    const user = userEvent.setup();
    render(<ListingEditDialog listingId="listing-1" open onOpenChange={mocks.onOpenChange} />);

    expect(await screen.findByDisplayValue("Island runabout")).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledWith("listing-1");
    expect(screen.getByText(/Photos are read-only here \(4\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review and save" }));
    expect(screen.getByText(/changed details will appear on the public listing immediately/i)).toBeInTheDocument();
  });

  it("blocks open seller revisions and does not allow save", async () => {
    mocks.load.mockResolvedValueOnce({
      data: { ...loadData, hasOpenRevision: true, openRevisionStatus: "PENDING" },
    });

    render(<ListingEditDialog listingId="listing-1" open onOpenChange={mocks.onOpenChange} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/seller revision is pending/i);
    expect(screen.getByRole("button", { name: "Review and save" })).toBeDisabled();
    await waitFor(() => expect(mocks.save).not.toHaveBeenCalled());
  });

  it("retains edits and recovers when the save request throws", async () => {
    mocks.save.mockRejectedValueOnce(new Error("connection lost"));
    const user = userEvent.setup();
    render(<ListingEditDialog listingId="listing-1" open onOpenChange={mocks.onOpenChange} />);
    const title = await screen.findByDisplayValue("Island runabout");
    await user.clear(title);
    await user.type(title, "Updated island runabout");
    await user.click(screen.getByRole("button", { name: "Review and save" }));
    await user.click(screen.getByRole("button", { name: "Confirm save" }));
    await screen.findByText(/Your edits are still here/);
    expect(screen.getByDisplayValue("Updated island runabout")).toBeInTheDocument();
    expect(mocks.onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review and save" })).not.toBeDisabled();
    });
  });

  it("asks before discarding dirty edits and keeps them when editing continues", async () => {
    const user = userEvent.setup();
    render(<ListingEditDialog listingId="listing-1" open onOpenChange={mocks.onOpenChange} />);
    const title = await screen.findByDisplayValue("Island runabout");
    await user.clear(title);
    await user.type(title, "Unsaved title");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByDisplayValue("Unsaved title")).toBeInTheDocument();
    expect(mocks.onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes pristine edits without a discard confirmation", async () => {
    const user = userEvent.setup();
    render(<ListingEditDialog listingId="listing-1" open onOpenChange={mocks.onOpenChange} />);
    await screen.findByDisplayValue("Island runabout");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });
});
