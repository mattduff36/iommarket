import { COST_OPEN_REQUEST_SLOT } from "@/lib/costs/config";
import { listInvoiceableEntries } from "@/lib/costs/queries";
import { sumMinor } from "@/lib/costs/money";
import { runSerializable } from "@/lib/costs/transaction";

export class CostInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostInvoiceError";
  }
}

export async function createInvoiceRequest(input: {
  requesterUserId: string;
}) {
  return runSerializable(async (tx) => {
    const open = await tx.invoiceRequest.findUnique({
      where: { openSlot: COST_OPEN_REQUEST_SLOT },
    });
    if (open) {
      throw new CostInvoiceError("An invoice request is already pending.");
    }

    const entries = await listInvoiceableEntries(tx);
    if (entries.length === 0) {
      throw new CostInvoiceError("There is no invoiceable balance to request.");
    }

    const frozenGbpMinor = sumMinor(entries.map((entry) => entry.markedGbpMinor));
    if (frozenGbpMinor <= BigInt(0)) {
      throw new CostInvoiceError("There is no invoiceable balance to request.");
    }

    const request = await tx.invoiceRequest.create({
      data: {
        status: "PENDING",
        openSlot: COST_OPEN_REQUEST_SLOT,
        requesterUserId: input.requesterUserId,
        frozenGbpMinor,
        frozenEntryCount: entries.length,
      },
    });

    await tx.invoiceRequestLine.createMany({
      data: entries.map((entry) => ({
        invoiceRequestId: request.id,
        costEntryId: entry.id,
        markedGbpMinor: entry.markedGbpMinor,
      })),
    });

    await tx.costWorkflowEvent.create({
      data: {
        invoiceRequestId: request.id,
        type: "INVOICE_REQUESTED",
        actorUserId: input.requesterUserId,
        payload: { requestId: request.id, status: "PENDING" },
      },
    });

    const outbox = await tx.costEmailOutbox.create({
      data: {
        invoiceRequestId: request.id,
        kind: "INVOICE_REQUEST",
        status: "PENDING",
        nextAttemptAt: new Date(),
      },
    });

    return { request, outboxId: outbox.id, entryIds: entries.map((entry) => entry.id) };
  });
}

export async function confirmInvoiceRequest(input: {
  requestId: string;
  confirmerUserId: string;
}) {
  return runSerializable(async (tx) => {
    const request = await tx.invoiceRequest.findUnique({
      where: { id: input.requestId },
      include: { lines: true },
    });
    if (!request) {
      throw new CostInvoiceError("Invoice request was not found.");
    }
    if (request.status === "CONFIRMED") {
      return { request, alreadyConfirmed: true };
    }
    if (request.status !== "PENDING") {
      throw new CostInvoiceError("Only a pending request can be confirmed.");
    }

    const claimed = await tx.invoiceRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: {
        status: "CONFIRMED",
        openSlot: null,
        confirmerUserId: input.confirmerUserId,
        confirmedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      const latest = await tx.invoiceRequest.findUnique({ where: { id: request.id } });
      if (latest?.status === "CONFIRMED") {
        return { request: latest, alreadyConfirmed: true };
      }
      throw new CostInvoiceError("Invoice request could not be confirmed.");
    }

    await tx.costSettlement.createMany({
      data: request.lines.map((line) => ({
        costEntryId: line.costEntryId,
        invoiceRequestId: request.id,
        markedGbpMinor: line.markedGbpMinor,
      })),
    });

    await tx.costWorkflowEvent.create({
      data: {
        invoiceRequestId: request.id,
        type: "INVOICE_CONFIRMED",
        actorUserId: input.confirmerUserId,
        payload: { requestId: request.id, status: "CONFIRMED" },
      },
    });

    const confirmed = await tx.invoiceRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    return { request: confirmed, alreadyConfirmed: false };
  });
}

export function safeInvoiceAuditDetails(input: {
  requestId: string;
  status: string;
}): Record<string, unknown> {
  return { requestId: input.requestId, status: input.status };
}
