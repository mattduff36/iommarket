import type { OpenIssueSnapshot } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;

export type SnapshotBinding = {
  snapshotId: string;
  checksum: string;
  databaseTargetFingerprint: string;
  expiresAt: string;
  safetyContract: string;
  manifestChecksum: string;
};

export function getArgumentValue(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function readSnapshotBinding(args: string[]): SnapshotBinding | null {
  const snapshotId = getArgumentValue(args, "--snapshot-id");
  const checksum = getArgumentValue(args, "--checksum");
  const databaseTargetFingerprint = getArgumentValue(args, "--database-fingerprint");
  const expiresAt = getArgumentValue(args, "--expires-at");
  const safetyContract = getArgumentValue(args, "--safety-contract");
  const manifestChecksum = getArgumentValue(args, "--manifest");
  if (
    !snapshotId ||
    !checksum ||
    !SHA256.test(checksum) ||
    !databaseTargetFingerprint ||
    !SHA256.test(databaseTargetFingerprint) ||
    !expiresAt ||
    !safetyContract ||
    !manifestChecksum ||
    !SHA256.test(manifestChecksum)
  ) {
    return null;
  }
  return {
    snapshotId,
    checksum,
    databaseTargetFingerprint,
    expiresAt,
    safetyContract,
    manifestChecksum,
  };
}

export function assertBindingMatches(snapshot: OpenIssueSnapshot, binding: SnapshotBinding): void {
  if (
    snapshot.snapshotId !== binding.snapshotId ||
    snapshot.checksum !== binding.checksum ||
    snapshot.manifestChecksum !== binding.manifestChecksum ||
    snapshot.expiresAt !== binding.expiresAt ||
    snapshot.safetyContract !== binding.safetyContract ||
    snapshot.databaseTargetFingerprint !== binding.databaseTargetFingerprint
  ) {
    throw new Error("Confirmation does not match the verified snapshot artifact");
  }
}

export function formatSnapshotBinding(snapshot: OpenIssueSnapshot): string {
  return [
    `--snapshot-id=${snapshot.snapshotId}`,
    `--checksum=${snapshot.checksum}`,
    `--database-fingerprint=${snapshot.databaseTargetFingerprint}`,
    `--expires-at=${snapshot.expiresAt}`,
    `--safety-contract=${snapshot.safetyContract}`,
    `--manifest=${snapshot.manifestChecksum}`,
  ].join(" ");
}
