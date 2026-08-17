import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export function isTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("Serializable cost transaction failed.");
}
