import type { PrismaClient } from "@prisma/client";
import { parseArgValue } from "../prod-mirror/safety";
import { PREVIEW_PROJECT_REF } from "../wipe-preview-marketplace/target";

export const PREVIEW_RENAME_CONFIRM = `yes rename founding preview packs ${PREVIEW_PROJECT_REF}`;
export const PREVIEW_CONFIRM_DB = `db.${PREVIEW_PROJECT_REF}.supabase.co/postgres`;

export function planMikeMotorsPreviewRename() {
  return {
    dealerKey: "mikes-motors",
    displayName: "Mike's Motors",
  };
}

export function parsePreviewRenameArgs(argv: string[]) {
  return {
    allow: parseArgValue(argv, "allow") === "1",
    destRef: parseArgValue(argv, "dest-ref") ?? null,
    confirmDb: parseArgValue(argv, "confirm-db") ?? null,
    confirm: parseArgValue(argv, "confirm") ?? null,
    apply: argv.includes("--apply"),
  };
}

export function assertPreviewRenameSafety(argv: string[], destConfirmDb: string) {
  const args = parsePreviewRenameArgs(argv);
  if (!args.allow) throw new Error("Refusing preview rename: --allow=1 is required.");
  if (args.destRef !== PREVIEW_PROJECT_REF) {
    throw new Error(`Refusing preview rename: --dest-ref must be ${PREVIEW_PROJECT_REF}.`);
  }
  if (destConfirmDb !== PREVIEW_CONFIRM_DB || args.confirmDb !== destConfirmDb) {
    throw new Error("Refusing preview rename: destination is not the preview database.");
  }
  if (args.apply && args.confirm !== PREVIEW_RENAME_CONFIRM) {
    throw new Error(`Refusing preview rename: --confirm must be "${PREVIEW_RENAME_CONFIRM}".`);
  }
  return args;
}

export async function applyMikeMotorsPreviewRename(prisma: PrismaClient) {
  const plan = planMikeMotorsPreviewRename();
  const pack = await prisma.dealerPreviewPack.findUnique({
    where: { dealerKey: plan.dealerKey },
    select: { id: true, dealerProfileId: true, displayName: true },
  });
  if (!pack) return { updated: false, ...plan };
  await prisma.$transaction([
    prisma.dealerPreviewPack.update({
      where: { dealerKey: plan.dealerKey },
      data: { displayName: plan.displayName },
    }),
    prisma.dealerProfile.update({
      where: { id: pack.dealerProfileId },
      data: { name: plan.displayName },
    }),
  ]);
  return { updated: true, ...plan };
}
