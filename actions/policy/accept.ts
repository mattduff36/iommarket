"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { recordAcceptance } from "@/lib/policy/acceptance";
import { db } from "@/lib/db";
import {
  acceptPoliciesSchema,
  type AcceptPoliciesInput,
} from "@/lib/validations/auth";

export async function acceptCurrentPolicies(input: AcceptPoliciesInput) {
  const user = await requireAuth();
  const parsed = acceptPoliciesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    await db.$transaction(async (tx) => {
      await recordAcceptance(tx, {
        userId: user.id,
        acceptanceType: "AGE_18",
        source: "GATE",
      });
      await recordAcceptance(tx, {
        userId: user.id,
        acceptanceType: "ACCOUNT_BUNDLE",
        source: "GATE",
      });
      await recordAcceptance(tx, {
        userId: user.id,
        acceptanceType: "PRIVACY_NOTICE",
        source: "GATE",
      });
    });
    revalidatePath("/account");
    revalidatePath("/account/accept-policies");
    return { data: { success: true } };
  } catch {
    return { error: "Unable to record policy acceptance." };
  }
}
