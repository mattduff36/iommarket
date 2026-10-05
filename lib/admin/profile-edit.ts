import type { SampleVisibility } from "@/lib/listings/sample-visibility";
import { isHiddenSampleUser } from "@/lib/listings/sample-visibility";
import {
  isPreviewPackUser,
  previewPacksVisibleOnFrontend,
} from "@/lib/preview-packs/frontend-visibility";

export const PROFILE_NOT_FOUND_MESSAGE = "Account not found.";
export const PROFILE_CONFLICT_MESSAGE =
  "This profile changed while the editor was open. Reload and try again.";
export const PROFILE_DELETED_MESSAGE =
  "This account is deleted. Restore it before editing the profile.";
export const PROFILE_NO_DEALER_MESSAGE = "This account has no dealer profile.";
export const PROFILE_DEALER_MISMATCH_MESSAGE =
  "This dealer profile does not belong to this account.";
export const PROFILE_REGION_MESSAGE = "Choose a valid region.";
export const PROFILE_SAVE_FAILED = "Could not save this profile.";
export const PROFILE_REFRESH_WARNING =
  "Profile saved, but the latest pages could not be refreshed. Reload them to see the update.";

const USER_FIELDS = ["name", "phone", "bio", "regionId"] as const;
const DEALER_FIELDS = ["name", "phone", "website", "bio"] as const;

export type ProfileEditCode =
  | "not_found"
  | "conflict"
  | "deleted"
  | "no_dealer"
  | "dealer_mismatch"
  | "invalid_region";

const PROFILE_EDIT_MESSAGES: Record<ProfileEditCode, string> = {
  not_found: PROFILE_NOT_FOUND_MESSAGE,
  conflict: PROFILE_CONFLICT_MESSAGE,
  deleted: PROFILE_DELETED_MESSAGE,
  no_dealer: PROFILE_NO_DEALER_MESSAGE,
  dealer_mismatch: PROFILE_DEALER_MISMATCH_MESSAGE,
  invalid_region: PROFILE_REGION_MESSAGE,
};

export class AdminProfileEditError extends Error {
  readonly code: ProfileEditCode;

  constructor(code: ProfileEditCode, message: string = PROFILE_EDIT_MESSAGES[code]) {
    super(message);
    this.name = "AdminProfileEditError";
    this.code = code;
  }
}

export interface AdminProfileAccountData {
  name: string | null;
  phone: string | null;
  bio: string | null;
  regionId: string | null;
}

export interface AdminProfileDealerData {
  dealerId: string;
  slug: string;
  updatedAt: string;
  name: string;
  phone: string | null;
  website: string | null;
  bio: string | null;
}

export interface AdminProfileEditorData {
  userId: string;
  userUpdatedAt: string;
  account: AdminProfileAccountData;
  dealer: AdminProfileDealerData | null;
  unchanged: boolean;
}

type AccountInput = {
  name?: string;
  phone?: string | null;
  bio?: string | null;
  regionId?: string | null;
};

type DealerInput = {
  name?: string;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

export type ProfileFieldChanges = Record<string, string | null>;

export interface ProfileChange<TData extends object = ProfileFieldChanges> {
  fields: string[];
  data: TData;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
}

export type ProfileChangeSet = ProfileChange<ProfileFieldChanges>;

export type AccountProfileWrite = {
  name?: string;
  phone?: string | null;
  bio?: string | null;
  regionId?: string | null;
};

export type DealerProfileWrite = {
  name?: string;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

export function sameProfileInstant(left: Date | string, right: Date | string) {
  return asInstant(left) === asInstant(right);
}

export function profileTargetAllowed(input: {
  authUserId: string;
  email: string;
  hasDealerProfile: boolean;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
  env?: NodeJS.ProcessEnv;
}) {
  if (
    isHiddenSampleUser({
      authUserId: input.authUserId,
      hasDealerProfile: input.hasDealerProfile,
      sampleVisibility: input.sampleVisibility,
    })
  ) {
    return false;
  }
  if (
    !previewPacksVisibleOnFrontend(input.env) &&
    isPreviewPackUser({
      authUserId: input.authUserId,
      email: input.email,
      dealerIsAdminPreview: input.isAdminPreview,
    })
  ) {
    return false;
  }
  return true;
}

export function accountProfileChanges(
  current: AdminProfileAccountData,
  input: AccountInput | undefined,
): ProfileChange<AccountProfileWrite> {
  const changes = emptyChange();
  if (!input) return changes as ProfileChange<AccountProfileWrite>;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length >= 2 && name !== (current.name ?? "")) {
      recordChange(changes, "name", current.name, name);
    }
  }
  recordClearable(changes, "phone", current.phone, input.phone);
  recordClearable(changes, "bio", current.bio, input.bio);
  if (input.regionId !== undefined && input.regionId !== current.regionId) {
    recordChange(changes, "regionId", current.regionId, input.regionId);
  }
  return changes as ProfileChange<AccountProfileWrite>;
}

export function dealerProfileChanges(
  current: {
    name: string;
    phone: string | null;
    website: string | null;
    bio: string | null;
  },
  input: DealerInput | undefined,
): ProfileChange<DealerProfileWrite> {
  const changes = emptyChange();
  if (!input) return changes as ProfileChange<DealerProfileWrite>;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length >= 2 && name !== current.name) {
      recordChange(changes, "name", current.name, name);
    }
  }
  recordClearable(changes, "phone", current.phone, input.phone);
  recordClearable(changes, "website", current.website, input.website);
  recordClearable(changes, "bio", current.bio, input.bio);
  return changes as ProfileChange<DealerProfileWrite>;
}

export function assertProfileWriteAllowlist(
  data: object,
  kind: "user" | "dealer",
) {
  const allowed: readonly string[] = kind === "user" ? USER_FIELDS : DEALER_FIELDS;
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      throw new Error(`Refusing to write ${kind}.${key}`);
    }
  }
}

export interface RevalidationTarget {
  path: string;
  type?: "page";
}

export function adminProfileRevalidationTargets(input: {
  userId: string;
  dealerSlug: string | null;
}): RevalidationTarget[] {
  const { userId, dealerSlug } = input;
  const targets: RevalidationTarget[] = [
    { path: "/" },
    { path: "/dealers" },
    { path: "/account" },
    { path: "/account/profile" },
    { path: "/dealer/dashboard" },
    { path: "/dealer/profile" },
    { path: "/admin" },
    { path: "/admin/users" },
    { path: `/admin/users/${userId}` },
    { path: `/admin/users/${userId}/profile` },
    { path: "/admin/dealers" },
    { path: "/admin/listings" },
    { path: "/admin/payments" },
    { path: "/admin/reviews" },
    { path: "/admin/cancellations" },
    { path: "/listings/[id]", type: "page" },
  ];
  if (!dealerSlug) return targets;
  if (/^[a-z0-9-]+$/.test(dealerSlug)) {
    targets.push(
      { path: `/dealers/${dealerSlug}` },
      { path: `/dealers/${dealerSlug}/social-image` },
    );
  }
  targets.push({ path: "/dealers/[slug]", type: "page" });
  return targets;
}

function emptyChange(): ProfileChangeSet {
  return { fields: [], data: {}, before: {}, after: {} };
}

function recordChange(
  changes: ProfileChangeSet,
  field: string,
  before: string | null,
  after: string | null,
) {
  changes.fields.push(field);
  changes.data[field] = after;
  changes.before[field] = before;
  changes.after[field] = after;
}

function recordClearable(
  changes: ProfileChangeSet,
  field: string,
  current: string | null,
  input: string | null | undefined,
) {
  if (input === undefined) return;
  const next = blankToNull(input);
  if (next !== current) recordChange(changes, field, current, next);
}

function blankToNull(value: string | null) {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function asInstant(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
