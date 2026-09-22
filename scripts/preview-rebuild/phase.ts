import {
  assertFingerprintsMatch,
  type PreserveFingerprint,
} from "./fingerprint";

export async function applyPreviewRebuildInTransaction<Tx>(input: {
  transaction: (
    work: (tx: Tx) => Promise<PreserveFingerprint>,
  ) => Promise<PreserveFingerprint>;
  apply: (tx: Tx) => Promise<void>;
  loadFingerprint: (tx: Tx) => Promise<PreserveFingerprint>;
  before: PreserveFingerprint;
  failAfterApply?: boolean;
}) {
  return input.transaction(async (tx) => {
    await input.apply(tx);
    if (input.failAfterApply) throw new Error("injected");
    const after = await input.loadFingerprint(tx);
    assertFingerprintsMatch(input.before, after);
    return after;
  });
}
