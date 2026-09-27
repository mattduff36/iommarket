import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserAccountStatusBadge } from "@/components/admin/user-account-status-badge";

describe("UserAccountStatusBadge", () => {
  it("shows Deleted once and gives it precedence over Disabled", () => {
    const { rerender } = render(
      <UserAccountStatusBadge deletedAt="2026-01-01" disabledAt="2026-01-01" />,
    );
    expect(screen.getAllByText("Deleted")).toHaveLength(1);
    expect(screen.queryByText("Disabled")).not.toBeInTheDocument();

    rerender(<UserAccountStatusBadge deletedAt={null} disabledAt="2026-01-01" />);
    expect(screen.getAllByText("Disabled")).toHaveLength(1);
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();

    rerender(<UserAccountStatusBadge deletedAt={null} disabledAt={null} />);
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
    expect(screen.queryByText("Disabled")).not.toBeInTheDocument();
  });
});
