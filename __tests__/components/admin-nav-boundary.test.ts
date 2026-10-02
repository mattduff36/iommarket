import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin navigation client boundary", () => {
  it("keeps lucide icons inside the client link and passes serializable items", () => {
    const layout = readFileSync("app/(admin)/layout.tsx", "utf8");
    const mobile = readFileSync("components/admin/admin-mobile-nav.tsx", "utf8");
    const link = readFileSync("components/admin/admin-nav-link.tsx", "utf8");

    for (const source of [layout, mobile]) {
      expect(source).toContain("<AdminNavLink");
      expect(source).toContain("item={item}");
      expect(source).not.toContain("LayoutDashboard");
      expect(source).not.toMatch(/icon=\{[A-Z]/);
    }

    expect(link.startsWith('"use client"')).toBe(true);
    expect(link).toContain("dashboard: LayoutDashboard");
    expect(link).toContain("NAV_ICONS[item.icon]");
  });
});
