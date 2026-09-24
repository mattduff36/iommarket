import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/actions/admin/regions", () => ({
  toggleRegionActive: vi.fn(),
  deleteRegion: vi.fn(),
}));

vi.mock("@/actions/admin", () => ({
  toggleCategoryActive: vi.fn(),
  deleteCategory: vi.fn(),
  deleteAttributeDefinition: vi.fn(),
}));

vi.mock("@/actions/waitlist", () => ({
  deleteWaitlistUser: vi.fn(),
  restoreWaitlistUser: vi.fn(),
}));

vi.mock("@/actions/admin/media", () => ({
  adminDeleteImage: vi.fn(),
}));

import { RegionActions } from "@/app/(admin)/admin/regions/region-actions";
import { CategoryRowActions } from "@/app/(admin)/admin/categories/category-actions";
import { WaitlistRowActions } from "@/app/(admin)/admin/waitlist/waitlist-row-actions";
import { DeleteImageButton } from "@/app/(admin)/admin/media/delete-image-button";

describe("secondary admin row actions", () => {
  it("offers only the relevant region, category, waitlist, and media actions", async () => {
    const user = userEvent.setup();
    let view = render(
      <RegionActions regionId="region-1" regionName="Douglas" active hasReferences />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Douglas" }));
    expect(screen.getByRole("menuitem", { name: "Disable" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    view.unmount();

    view = render(
      <CategoryRowActions
        categoryId="category-1"
        categoryName="Cars"
        active={false}
        listingCount={0}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Cars" }));
    expect(screen.getByRole("menuitem", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    view.unmount();

    view = render(<WaitlistRowActions id="wait-1" email="ada@example.com" deleted={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for ada@example.com" }));
    expect(screen.getByRole("menuitem", { name: "Copy email" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    view.unmount();

    render(<DeleteImageButton imageId="image-1" listingTitle="Test van" />);
    await user.click(screen.getByRole("button", { name: "Actions for Test van" }));
    expect(screen.getByRole("menuitem", { name: "Delete image" })).toBeInTheDocument();
  });
});
