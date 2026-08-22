import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FINALISE_VERIFY_STEPS } from "../../../scripts/finalise/steps";

const root = process.cwd();

describe("finalise package scripts", () => {
  it("wires the same command names as avsworklog, without migration or version steps", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.finalise).toBe("tsx scripts/finalise.ts");
    expect(pkg.scripts?.["finalise:push"]).toBe("tsx scripts/finalise.ts --push");
    expect(pkg.scripts?.["finalise:full"]).toBe("tsx scripts/finalise.ts --full");
    expect(pkg.scripts?.["finalise:full:push"]).toBe("tsx scripts/finalise.ts --full --push");
    expect(pkg.scripts?.["finalise:repair"]).toBe("tsx scripts/finalise-repair.ts");
    expect(existsSync(path.join(root, "scripts", "finalise.ts"))).toBe(true);
    expect(existsSync(path.join(root, "scripts", "finalise-repair.ts"))).toBe(true);
    expect(pkg.scripts?.finalise).not.toContain("db:migrate");
    expect(pkg.scripts?.finalise).not.toContain("db:push");
  });

  it("keeps ordinary verify on typecheck and tests, and full verify on lint plus build", () => {
    expect(FINALISE_VERIFY_STEPS.filter((step) => !step.fullOnly).map((step) => step.rendered)).toEqual([
      "npm run typecheck",
      "npm run test:run",
    ]);
    expect(FINALISE_VERIFY_STEPS.filter((step) => step.fullOnly).map((step) => step.rendered)).toEqual([
      "npm run lint",
      "npm run build",
    ]);
  });
});
