// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResponsiveTableFrame } from "@/components/ui/responsive-table-frame";

afterEach(cleanup);

function Records({ updated = false }: { updated?: boolean }) {
  return <ResponsiveTableFrame><table>
    <thead><tr><th><a href="?sort=name">Name</a></th><th>Access</th></tr></thead>
    <tbody>{updated ? <tr><td>New record</td><td>Active</td></tr> : <>
      <tr><td>Existing record</td><td>Pending</td></tr>
      <tr><td colSpan={2}>No further records</td></tr>
    </>}</tbody>
  </table></ResponsiveTableFrame>;
}

describe("responsive table labels", () => {
  it("uses rendered sortable headings without labelling full-width rows", () => {
    const { container } = render(<Records />);
    const cells = container.querySelectorAll("td");
    expect(cells[0].getAttribute("data-label")).toBe("Name");
    expect(cells[1].getAttribute("data-label")).toBe("Access");
    expect(cells[2].hasAttribute("data-label")).toBe(false);
    expect(container.querySelector("[data-ready=true]")).not.toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("?sort=name");
  });

  it("labels replacement rows after client pagination", async () => {
    const { container, rerender } = render(<Records />);
    rerender(<Records updated />);
    await waitFor(() => expect(container.querySelector("td")?.dataset.label).toBe("Name"));
    expect(container.querySelectorAll("td")[1].dataset.label).toBe("Access");
  });

  it("keeps complex spanning headers in their semantic table layout", () => {
    const { container } = render(<ResponsiveTableFrame><table>
      <thead><tr><th colSpan={2}>Comparison</th></tr></thead>
      <tbody><tr><td>One</td><td>Two</td></tr></tbody>
    </table></ResponsiveTableFrame>);
    expect(container.querySelector("[data-ready]")).toBeNull();
  });
});
