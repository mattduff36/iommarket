import type { CostInvoiceability } from "@prisma/client";

export interface ExistingLedgerRevision {
  revision: number;
  checksum: string;
  invoiceability: CostInvoiceability;
  chargeEntryId: string;
  markedGbpMinor: bigint;
  fxRateSnapshotId: string | null;
  nativeAmount: string;
  nativeCurrency: string;
}

export type LedgerRevisionPlan =
  | { type: "skip" }
  | { type: "create"; revision: 1 }
  | {
      type: "reverse-replace";
      reverseEntryId: string;
      nextRevision: number;
      originalMarkedGbpMinor: bigint;
      originalFxRateSnapshotId: string | null;
      originalNativeAmount: string;
      originalNativeCurrency: string;
    };

export function planLedgerRevision(
  existing: ExistingLedgerRevision | null,
  incoming: { checksum: string; invoiceability: CostInvoiceability },
): LedgerRevisionPlan {
  if (!existing) {
    return { type: "create", revision: 1 };
  }

  if (
    existing.checksum === incoming.checksum &&
    existing.invoiceability === incoming.invoiceability
  ) {
    return { type: "skip" };
  }

  return {
    type: "reverse-replace",
    reverseEntryId: existing.chargeEntryId,
    nextRevision: existing.revision + 1,
    originalMarkedGbpMinor: existing.markedGbpMinor,
    originalFxRateSnapshotId: existing.fxRateSnapshotId,
    originalNativeAmount: existing.nativeAmount,
    originalNativeCurrency: existing.nativeCurrency,
  };
}
