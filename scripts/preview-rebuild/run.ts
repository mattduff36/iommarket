import {
  EXPIRED_COUNT,
  LIVE_COUNT,
  SOLD_COUNT,
  TARGET_PRIVATE_SELLERS,
  TARGET_PUBLIC_DEALERS,
} from "../../prisma/seed/constants";
import { DELETE_AUTH_EMAILS } from "../wipe-preview-marketplace/target";
import type { VerifiedBackup } from "./backups";
import {
  assertConfirmationToken,
  buildRebuildSnapshot,
  confirmationToken,
  formatConfirmationCard,
  type RebuildSnapshot,
} from "./snapshot";
import { assertApprovedAuthDeletion, assertRetainedAuthRoster } from "./auth";
import { assertFingerprintsMatch, type PreserveFingerprint } from "./fingerprint";

export interface RebuildLiveState {
  prismaEmails: string[];
  authEmails: string[];
  listingCount: number;
  listingByStatus: Record<string, number>;
  dealerNames: string[];
  preserve: PreserveFingerprint;
}

export interface PreviewRebuildHooks {
  verifyBackups: (cwd: string) => {
    preview: VerifiedBackup;
    production: VerifiedBackup;
  };
  loadState: () => Promise<RebuildLiveState>;
  mutate?: {
    deleteAuth: (emails: readonly string[]) => Promise<void>;
    verifyAuth: () => Promise<string[]>;
    rebuildDatabase: (before: PreserveFingerprint) => Promise<PreserveFingerprint>;
  };
}

export async function runPreviewRebuild(input: {
  cwd?: string;
  confirm?: string;
  write?: (text: string) => void;
  hooks: PreviewRebuildHooks;
}) {
  const cwd = input.cwd ?? process.cwd();
  const write = input.write ?? ((text: string) => process.stdout.write(text));
  const planned = {
    live: LIVE_COUNT,
    sold: SOLD_COUNT,
    expired: EXPIRED_COUNT,
    dealers: TARGET_PUBLIC_DEALERS,
    privateSellers: TARGET_PRIVATE_SELLERS,
  };
  const backups = input.hooks.verifyBackups(cwd);
  const snapshotFrom = (state: RebuildLiveState) =>
    buildRebuildSnapshot({
      prismaEmails: state.prismaEmails,
      authEmails: state.authEmails,
      deleteAuthEmails: [...DELETE_AUTH_EMAILS],
      listingCount: state.listingCount,
      listingByStatus: state.listingByStatus,
      dealerNames: state.dealerNames,
      backups,
      preserve: state.preserve,
      planned,
    });
  const snapshot = snapshotFrom(await input.hooks.loadState());
  const token = confirmationToken(snapshot);
  write(formatConfirmationCard(snapshot));
  if (!input.confirm) {
    return { mutated: false, token, snapshot };
  }

  assertConfirmationToken(snapshot, input.confirm);
  assertConfirmationToken(snapshotFrom(await input.hooks.loadState()), input.confirm);

  if (!input.hooks.mutate) {
    throw new Error("Refusing rebuild: mutation hooks are not available.");
  }

  const deleteEmails = snapshot.deleteAuthEmails;
  assertApprovedAuthDeletion({
    snapshotDeleteEmails: deleteEmails,
    requestedEmails: deleteEmails,
  });
  await input.hooks.mutate.deleteAuth(deleteEmails);
  assertRetainedAuthRoster(await input.hooks.mutate.verifyAuth());
  const after = await input.hooks.mutate.rebuildDatabase(snapshot.preserve);
  assertFingerprintsMatch(snapshot.preserve, after);
  return { mutated: true, token, snapshot };
}

export function snapshotWithoutMutation(snapshot: RebuildSnapshot) {
  return { mutated: false as const, token: confirmationToken(snapshot), snapshot };
}
