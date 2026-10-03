import { describe, it, expect } from "vitest";
import {
  getDueDateVariant,
  getPositionVariant,
  getStatusVariant,
} from "@/lib/utils/vehicle-check-status";

describe("vehicle check status tones", () => {
  it.each(["Untaxed", "Not taxed", "Not valid", "Invalid", "Expired", "Inactive", "Failed", "Fail"])(
    "marks negative status %s as an error before matching positive substrings",
    (status) => {
      expect(getStatusVariant(status)).toBe("error");
    },
  );

  it.each(["Taxed", "Valid", "Active", "Passed", "Pass"])(
    "marks positive status %s as successful",
    (status) => {
      expect(getStatusVariant(status)).toBe("success");
    },
  );

  it.each([null, undefined, "", "Unknown", "Not checked"])(
    "keeps unknown status %s neutral",
    (status) => {
      expect(getStatusVariant(status)).toBe("neutral");
    },
  );

  it("uses warning for SORN and neutral for unrecognized status wording", () => {
    expect(getStatusVariant("SORN")).toBe("warning");
    expect(getStatusVariant("Tax status unavailable")).toBe("neutral");
  });
});

describe("vehicle check due-date tones", () => {
  // 23:30Z is already the following calendar day in London in October.
  const checkedAt = "2026-10-03T23:30:00.000Z";

  it("uses UK calendar dates and includes the due day in the warning window", () => {
    expect(getDueDateVariant("2026-10-03", checkedAt)).toBe("error");
    expect(getDueDateVariant("2026-10-04", checkedAt)).toBe("warning");
    expect(getDueDateVariant("2026-11-03", checkedAt)).toBe("warning");
    expect(getDueDateVariant("2026-11-04", checkedAt)).toBe("success");
  });

  it.each([null, undefined, "", "not-a-date", "2026-02-30", "2026-10"])(
    "keeps invalid or missing due date %s neutral",
    (date) => {
      expect(getDueDateVariant(date, checkedAt)).toBe("neutral");
    },
  );

  it("preserves a negative status even when a future due date exists", () => {
    expect(getPositionVariant("Untaxed", "2027-01-01", checkedAt)).toBe("error");
  });
});
