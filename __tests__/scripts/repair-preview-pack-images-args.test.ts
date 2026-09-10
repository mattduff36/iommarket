import { describe, expect, it } from "vitest";
import {
  AFFECTED_PREVIEW_PACK_KEYS,
  PREVIEW_APPLY_CONFIRM_TOKEN,
  PREVIEW_CONFIRM_DB,
  PREVIEW_PROJECT_REF,
  assertPreviewPackRepairSafety,
  assertExactPreviewRepairEnvironment,
  selectedPreviewRepairDealers,
} from "../../scripts/repair-preview-pack-images/safety";
import {
  assertPreviewRepairPlanBinding,
  buildPreviewRepairPlan,
} from "../../scripts/repair-preview-pack-images/plan";

const gates = [
  `--allow=1`,
  `--dest-ref=${PREVIEW_PROJECT_REF}`,
  `--confirm-db=${PREVIEW_CONFIRM_DB}`,
];

describe("preview pack image repair safety", () => {
  it("refuses missing allow, production dest, and unknown dealers", () => {
    expect(() => assertPreviewPackRepairSafety({ argv: gates })).toThrow(/dealer/);
    expect(() =>
      assertPreviewPackRepairSafety({
        argv: [`--dest-ref=${PREVIEW_PROJECT_REF}`, `--confirm-db=${PREVIEW_CONFIRM_DB}`, "--dealer=rex-motor-company"],
      }),
    ).toThrow(/--allow=1/);
    expect(() =>
      assertPreviewPackRepairSafety({
        argv: [
          "--allow=1",
          "--dest-ref=snlqivvogfqesxpbjiei",
          `--confirm-db=${PREVIEW_CONFIRM_DB}`,
          "--dealer=rex-motor-company",
        ],
      }),
    ).toThrow(/dest-ref/);
    expect(() =>
      assertPreviewPackRepairSafety({
        argv: [...gates, "--dealer=athol-garage"],
      }),
    ).toThrow(/affected pack list/);
  });

  it("selects one dealer or the full affected list", () => {
    const one = assertPreviewPackRepairSafety({
      argv: [...gates, "--dealer=rex-motor-company"],
    });
    expect(one.dryRun).toBe(true);
    expect(selectedPreviewRepairDealers(one)).toEqual(["rex-motor-company"]);
    const all = assertPreviewPackRepairSafety({
      argv: [...gates, "--all-affected"],
    });
    expect(all.dryRun).toBe(true);
    expect(selectedPreviewRepairDealers(all)).toEqual([...AFFECTED_PREVIEW_PACK_KEYS]);
  });

  it("requires frozen-plan binding and explicit confirmation for apply", () => {
    expect(() => assertPreviewPackRepairSafety({
      argv: [...gates, "--dealer=rex-motor-company", "--apply"],
    })).toThrow(/--confirm/);
    const apply = assertPreviewPackRepairSafety({
      argv: [
        ...gates,
        "--dealer=rex-motor-company",
        "--apply",
        `--confirm=${PREVIEW_APPLY_CONFIRM_TOKEN}`,
        "--snapshot=run-1",
        "--plan-fingerprint=abc",
        "--plan-count=1",
      ],
    });
    expect(apply.dryRun).toBe(false);
  });

  it("PREVIEW-TARGET-001 accepts only exact preview database and Supabase identities", () => {
    expect(assertExactPreviewRepairEnvironment({
      databaseUrl: `postgresql://postgres:pw@db.${PREVIEW_PROJECT_REF}.supabase.co:5432/postgres`,
      supabaseUrl: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
    })).toContain(PREVIEW_PROJECT_REF);
    expect(() => assertExactPreviewRepairEnvironment({
      databaseUrl: `postgresql://postgres:pw@evil.example/postgres?ref=${PREVIEW_PROJECT_REF}`,
      supabaseUrl: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
    })).toThrow(/exact preview/);
  });

  it("PREVIEW-BIND-001 requires the operator flags to match the exact frozen plan", () => {
    const plan = buildPreviewRepairPlan({
      runId: "run-1",
      dealers: ["rex-motor-company"],
      packs: [{
        dealerKey: "rex-motor-company",
        listingCount: 0,
        items: [],
        skipped: [],
      }],
    });
    expect(() => assertPreviewRepairPlanBinding({
      plan,
      snapshot: "run-1",
      planFingerprint: "wrong",
      planCount: "0",
      dealers: ["rex-motor-company"],
    })).toThrow(/frozen plan/);
    expect(() => assertPreviewRepairPlanBinding({
      plan,
      snapshot: "run-1",
      planFingerprint: plan.planFingerprint,
      planCount: "0",
      dealers: ["rex-motor-company"],
    })).not.toThrow();
  });
});
