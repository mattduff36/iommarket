import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const WINDOW_MS = 15 * 60_000;
const MAX_EMAIL_ATTEMPTS = 3;
const MAX_ADDRESS_ATTEMPTS = 10;

type BucketRow = {
  count: number;
  resetAt: Date;
};

function hashIdentifier(scope: string, identifier: string) {
  return createHash("sha256")
    .update(`${scope}\0${identifier.trim().toLowerCase()}`)
    .digest("hex");
}

export async function consumeRateLimitBucket(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  scope: "email" | "address" | "featured-receipt-code",
  identifier: string,
  now: Date,
  windowMs = WINDOW_MS,
): Promise<BucketRow> {
  const key = hashIdentifier(scope, identifier);
  const nextReset = new Date(now.getTime() + windowMs);
  const rows = await tx.$queryRaw<BucketRow[]>(Prisma.sql`
    INSERT INTO "SignupRateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${nextReset}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "SignupRateLimitBucket"."resetAt" <= ${now} THEN 1
        ELSE "SignupRateLimitBucket"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "SignupRateLimitBucket"."resetAt" <= ${now} THEN ${nextReset}
        ELSE "SignupRateLimitBucket"."resetAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `);
  const bucket = rows[0];
  if (!bucket) throw new Error(scope === "featured-receipt-code" ? "Receipt code attempt could not be recorded." : "Signup rate limit could not be recorded.");
  return bucket;
}

export async function checkSignupRateLimit(input: {
  email: string;
  clientAddress: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "SignupRateLimitBucket"
      WHERE "resetAt" <= ${now}
    `);
    const addressBucket = await consumeRateLimitBucket(
      tx,
      "address",
      input.clientAddress,
      now,
    );
    if (addressBucket.count > MAX_ADDRESS_ATTEMPTS) {
      return { allowed: false, resetAt: addressBucket.resetAt };
    }
    const emailBucket = await consumeRateLimitBucket(tx, "email", input.email, now);
    return {
      allowed: emailBucket.count <= MAX_EMAIL_ATTEMPTS,
      resetAt: emailBucket.resetAt,
    };
  });
}
