import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DealerOpeningHours } from "@/components/dealers/opening-hours";
import { emptyOpeningHours } from "@/lib/dealers/opening-hours";

describe("public dealer opening hours", () => {
  it("hides disabled, absent and invalid schedules", () => {
    for (const hours of [null, {}, emptyOpeningHours()]) {
      expect(renderToStaticMarkup(<DealerOpeningHours enabled hours={hours} />)).toBe("");
    }
    const hours = emptyOpeningHours(); hours.days[0] = { status: "24hours", periods: [] };
    expect(renderToStaticMarkup(<DealerOpeningHours enabled={false} hours={hours} />)).toBe("");
  });
  it("renders all seven days and escapes notes", () => {
    const hours = emptyOpeningHours();
    hours.days[0] = { status: "open", periods: [{ opens: "09:00", closes: "17:30" }] };
    hours.days[5] = { status: "24hours", periods: [] };
    hours.days[6] = { status: "appointment", periods: [] };
    hours.note = "<script>alert(1)</script>";
    const html = renderToStaticMarkup(<DealerOpeningHours enabled hours={hours} />);
    expect(html).toContain("09:00–17:30");
    expect(html).toContain("Open 24 hours");
    expect(html).toContain("By appointment");
    expect(html).toContain("Sunday");
    expect(html).not.toContain("<script>");
  });
});
