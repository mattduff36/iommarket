import { describe, expect, it } from "vitest";
import { createBackupManifest } from "../../scripts/prod-mirror/manifest";
import {
  assertMirrorSafety,
  assertNoSafetyKeysInEnvFile,
} from "../../scripts/prod-mirror/safety";

const previewConfirm = "db.syneonzucehwlghqmfbg.supabase.co/postgres";
const productionConfirm = "db.snlqivvogfqesxpbjiei.supabase.co/postgres";
const backupId = "pmr-test-backup-1";

const requiredWriteFlags = [
  "copy-waitlist",
  "--allow=1",
  "--source-ref=syneonzucehwlghqmfbg",
  "--dest-ref=snlqivvogfqesxpbjiei",
  `--backup-id=${backupId}`,
  `--confirm-db=${previewConfirm}`,
  "--writers-paused=1",
];

describe("PMR-SAFE-001 confirmations fail before a write connection opens", () => {
  it("throws on missing write flags and never returns a safety token", () => {
    const attempts = [
      ["copy-waitlist"],
      ["copy-waitlist", "--allow=1"],
      ["copy-waitlist", "--allow=1", "--source-ref=syneonzucehwlghqmfbg", "--dest-ref=snlqivvogfqesxpbjiei"],
      [
        "copy-waitlist",
        "--allow=1",
        "--source-ref=syneonzucehwlghqmfbg",
        "--dest-ref=snlqivvogfqesxpbjiei",
        `--backup-id=${backupId}`,
        `--confirm-db=${previewConfirm}`,
      ],
    ];
    for (const argv of attempts) {
      expect(() =>
        assertMirrorSafety({
          argv,
          writeConfirmDb: previewConfirm,
          backupId,
          backupConfirmDb: previewConfirm,
        }),
      ).toThrow(/Refusing mirror/);
    }
  });

  it("rejects confirmation flags that were loaded from an env file", () => {
    expect(() =>
      assertNoSafetyKeysInEnvFile({
        DATABASE_URL: "postgres://x",
        PROD_MIRROR_ALLOW: "1",
      }),
    ).toThrow("not env files");
  });

  it("rejects backup metadata that does not match the invocation", () => {
    const manifest = createBackupManifest({
      id: backupId,
      targetRef: "syneonzucehwlghqmfbg",
      confirmDb: previewConfirm,
      files: [],
    });
    expect(manifest.id).toBe(backupId);
    expect(() =>
      assertMirrorSafety({
        argv: requiredWriteFlags.map((flag) =>
          flag.startsWith("--backup-id=") ? "--backup-id=other" : flag,
        ),
        writeConfirmDb: previewConfirm,
        backupId,
        backupConfirmDb: previewConfirm,
      }),
    ).toThrow("backup-id");
    expect(() =>
      assertMirrorSafety({
        argv: [
          "restore",
          "--allow=1",
          "--source-ref=syneonzucehwlghqmfbg",
          "--dest-ref=snlqivvogfqesxpbjiei",
          `--backup-id=${backupId}`,
          `--confirm-db=${productionConfirm}`,
          "--writers-paused=1",
        ],
        writeConfirmDb: productionConfirm,
        backupId,
        backupConfirmDb: previewConfirm,
      }),
    ).toThrow("dump metadata");
  });

  it("allows read-only backup without writers-paused or backup-id flags", () => {
    const cleared = assertMirrorSafety({
      argv: [
        "backup",
        "--allow=1",
        "--source-ref=syneonzucehwlghqmfbg",
        "--dest-ref=snlqivvogfqesxpbjiei",
        "--target=preview",
      ],
      writeConfirmDb: previewConfirm,
      backupId,
      backupConfirmDb: previewConfirm,
    });
    expect(cleared.confirmations.command).toBe("backup");
  });

  it("returns a safety token only after every write confirmation matches", () => {
    const cleared = assertMirrorSafety({
      argv: requiredWriteFlags,
      writeConfirmDb: previewConfirm,
      backupId,
      backupConfirmDb: previewConfirm,
    });
    expect(cleared.brand).toBe("prod-mirror-safety");
    expect(cleared.confirmations.command).toBe("copy-waitlist");
  });
});
