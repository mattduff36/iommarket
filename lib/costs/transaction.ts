import { Prisma } from "@prisma/client";
import { costDb } from "@/lib/costs/db";

export function isTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export type SerializableTransactionOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
};

export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await costDb.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("Serializable cost transaction failed.");
}
