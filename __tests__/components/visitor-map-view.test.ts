import { describe, expect, it } from "vitest";
import {
  ISLE_OF_MAN_CENTER,
  defaultVisitorMapBounds,
} from "@/components/admin/analytics/visitor-map-view";

describe("default visitor map view", () => {
  it("keeps the Isle of Man in the centre and frames most of the UK", () => {
    const [[west, south], [east, north]] = defaultVisitorMapBounds();
    const [longitude, latitude] = ISLE_OF_MAN_CENTER;

    expect((west + east) / 2).toBeCloseTo(longitude);
    expect((south + north) / 2).toBeCloseTo(latitude);
    expect(west).toBeLessThan(-8);
    expect(east).toBeGreaterThan(1.4);
    expect(south).toBeLessThan(50.2);
    expect(north).toBeGreaterThan(58.5);
  });
});
