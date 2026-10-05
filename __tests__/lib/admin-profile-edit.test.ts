import { describe, expect, it } from "vitest";
import {
  accountProfileChanges,
  adminProfileRevalidationTargets,
  dealerProfileChanges,
  profileTargetAllowed,
} from "@/lib/admin/profile-edit";
import { DEFAULT_SAMPLE_VISIBILITY } from "@/lib/listings/sample-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

const productionEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  ITRADER_DEPLOYMENT_ROLE: "production",
} as NodeJS.ProcessEnv;

const account = {
  name: "Account Holder",
  phone: "01624 111111",
  bio: "Account bio",
  regionId: "clregionxxxxxxxxxxxxxxxxxx",
};

const dealer = {
  name: "Ocean Motor Village Preview",
  phone: "01624 222222",
  website: "https://www.oceanmotorvillage.com",
  bio: "Dealer bio",
};

describe("admin profile change detection", () => {
  it("leaves omitted fields unchanged and clears explicit empty values", () => {
    expect(dealerProfileChanges(dealer, { name: "Ocean Motor Village" })).toEqual({
      fields: ["name"],
      data: { name: "Ocean Motor Village" },
      before: { name: "Ocean Motor Village Preview" },
      after: { name: "Ocean Motor Village" },
    });

    expect(accountProfileChanges(account, { phone: "", bio: null })).toMatchObject({
      fields: ["phone", "bio"],
      data: { phone: null, bio: null },
    });
    expect(accountProfileChanges(account, {}).data).toEqual({});
    expect(dealerProfileChanges(dealer, undefined).fields).toEqual([]);
  });

  it("does not treat an unchanged dealer name as an account rename", () => {
    const change = accountProfileChanges(account, { name: "Account Holder" });
    expect(change.fields).toEqual([]);
  });
});

describe("admin profile visibility", () => {
  it("hides preview-pack accounts in production without reading the display name", () => {
    expect(profileTargetAllowed({
      authUserId: "auth-harbour",
      email: "harbour@example.com",
      hasDealerProfile: true,
      isAdminPreview: true,
      sampleVisibility: DEFAULT_SAMPLE_VISIBILITY,
      env: productionEnv,
    })).toBe(false);

    expect(profileTargetAllowed({
      authUserId: "auth-ocean",
      email: "oceanmotorvillage@itrader.im.preview",
      hasDealerProfile: true,
      isAdminPreview: false,
      sampleVisibility: DEFAULT_SAMPLE_VISIBILITY,
      env: productionEnv,
    })).toBe(true);

    expect(profileTargetAllowed({
      authUserId: "00000000-0000-0000-0000-000000000099",
      email: "sample-dealer@example.com",
      hasDealerProfile: true,
      isAdminPreview: false,
      sampleVisibility: { ...DEFAULT_SAMPLE_VISIBILITY, dealerListings: false },
      env: productionEnv,
    })).toBe(false);
  });

  it("keeps preview-pack accounts reachable when staging already shows them", () => {
    expect(profileTargetAllowed({
      authUserId: "preview-system:harbour",
      email: "preview+harbour@preview.internal",
      hasDealerProfile: true,
      isAdminPreview: true,
      sampleVisibility: DEFAULT_SAMPLE_VISIBILITY,
      env: verifiedStagingEnv,
    })).toBe(true);
  });
});

describe("admin profile revalidation", () => {
  it("covers admin, public dealer, and listing seller routes", () => {
    const targets = adminProfileRevalidationTargets({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      dealerSlug: "ocean-motor-village",
    });
    const paths = targets.map((target) => target.path);

    expect(paths).toEqual(expect.arrayContaining([
      "/admin/users",
      "/admin/users/clxxxxxxxxxxxxxxxxxxxxxxxxx",
      "/admin/users/clxxxxxxxxxxxxxxxxxxxxxxxxx/profile",
      "/admin/dealers",
      "/admin/listings",
      "/dealers",
      "/dealers/ocean-motor-village",
      "/dealers/ocean-motor-village/social-image",
      "/",
    ]));
    expect(targets).toEqual(expect.arrayContaining([
      { path: "/listings/[id]", type: "page" },
      { path: "/dealers/[slug]", type: "page" },
    ]));
  });
});
