// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminRecordLink } from "@/components/admin/admin-record-link";

describe("AdminRecordLink", () => {
  it("renders a same-tab label link", () => {
    render(<AdminRecordLink href="/admin/users/user-1">Ada</AdminRecordLink>);

    const link = screen.getByRole("link", { name: "Ada" });
    expect(link.getAttribute("href")).toBe("/admin/users/user-1");
    expect(link.getAttribute("target")).toBeNull();
    expect(link.className).toContain("hover:underline");
    expect(link.className).toContain("focus-visible:underline");
    expect(screen.queryByText(/opens in a new tab/)).toBeNull();
  });

  it("opens listing reviews in a new tab", () => {
    render(
      <AdminRecordLink href="/listings/listing-1?adminReview=1" external>
        Blue van
      </AdminRecordLink>,
    );

    const link = screen.getByRole("link", { name: "Blue van. Opens in a new tab" });
    expect(link.getAttribute("href")).toBe("/listings/listing-1?adminReview=1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(". Opens in a new tab").className).toContain("sr-only");
  });
});
