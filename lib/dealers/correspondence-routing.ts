import { db } from "@/lib/db";
import {
  resolveCorrespondenceRecipients,
  type CorrespondenceRoutingSettings,
  type DealerCorrespondenceCategory,
} from "@/lib/dealers/correspondence";

export async function resolveDealerMailRecipients(input: {
  dealerId?: string | null;
  primaryEmail: string;
  category: DealerCorrespondenceCategory;
}): Promise<string[]> {
  try {
    const settings = input.dealerId
      ? await readCorrespondenceRouting(input.dealerId)
      : null;
    return resolveCorrespondenceRecipients({
      primaryEmail: input.primaryEmail,
      category: input.category,
      settings,
    });
  } catch {
    return resolveCorrespondenceRecipients({
      primaryEmail: input.primaryEmail,
      category: input.category,
      settings: null,
    });
  }
}

async function readCorrespondenceRouting(
  dealerId: string,
): Promise<CorrespondenceRoutingSettings | null> {
  const settings = await db.dealerCorrespondenceSettings.findUnique({
    where: { dealerId },
    select: {
      verifiedEmail: true,
      categories: true,
      copyAssignedToPrimary: true,
    },
  });
  if (!settings) return null;
  return {
    verifiedEmail: settings.verifiedEmail,
    categories: settings.categories,
    copyAssignedToPrimary: settings.copyAssignedToPrimary,
  };
}
