import type { Prisma } from "@prisma/client";
import {
  getWriteOffConfigurationError,
  isVehicleCategorySlug,
  validateListingAttributes,
  type ListingAttributeDefinitionLike,
  type ListingAttributeInputLike,
} from "@/lib/listings/attribute-ui";
import {
  WRITE_OFF_CATEGORY_SLUG,
  WRITE_OFF_CONFIG_ERROR,
  WRITE_OFF_SUBMIT_ERROR,
  isWriteOffCategoryValue,
} from "@/lib/listings/write-off-category";
import { getPolicyFlags } from "@/lib/policy/flags";

export { WRITE_OFF_CONFIG_ERROR, WRITE_OFF_SUBMIT_ERROR, getWriteOffConfigurationError };

export type ListingNsPolicyContext = {
  enforceListingNs?: boolean;
};

type PolicyDb = Prisma.TransactionClient | (typeof import("@/lib/db"))["db"];

export function validateListingAttributesWithServerPolicy(params: {
  categorySlug: string | undefined;
  definitions: ListingAttributeDefinitionLike[];
  attributes: ListingAttributeInputLike[];
}) {
  return validateListingAttributes({
    ...params,
    enforceListingNs: getPolicyFlags().enforceListingNs,
  });
}

export type ListingWriteOffReadiness =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

export async function getListingWriteOffReadiness(params: {
  listingId: string;
  listingStatus: string;
  client?: PolicyDb;
}): Promise<ListingWriteOffReadiness> {
  if (!getPolicyFlags().enforceListingNs) {
    return { ok: true };
  }

  const client = params.client ?? (await import("@/lib/db")).db;
  const listing = await client.listing.findUnique({
    where: { id: params.listingId },
    select: {
      status: true,
      category: {
        select: {
          slug: true,
          attributeDefinitions: {
            where: { slug: WRITE_OFF_CATEGORY_SLUG },
            select: {
              id: true,
              slug: true,
              name: true,
              dataType: true,
              required: true,
              options: true,
            },
          },
        },
      },
    },
  });

  if (!listing) {
    return { ok: false, error: WRITE_OFF_SUBMIT_ERROR };
  }

  const categorySlug = listing.category?.slug;
  if (!isVehicleCategorySlug(categorySlug)) {
    return { ok: true };
  }

  const definition = listing.category?.attributeDefinitions[0];
  const configurationError = getWriteOffConfigurationError(
    categorySlug,
    definition ? [definition] : [],
    { enforceListingNs: true },
  );
  if (configurationError) {
    return { ok: false, error: configurationError };
  }

  const writeOff =
    params.listingStatus === "LIVE"
      ? await client.listingRevisionAttributeValue.findFirst({
          where: {
            revision: {
              listingId: params.listingId,
              status: { in: ["DRAFT", "PENDING"] },
            },
            attributeDefinition: { slug: WRITE_OFF_CATEGORY_SLUG },
          },
          select: { value: true },
        })
      : await client.listingAttributeValue.findFirst({
          where: {
            listingId: params.listingId,
            attributeDefinition: { slug: WRITE_OFF_CATEGORY_SLUG },
          },
          select: { value: true },
        });

  if (!isWriteOffCategoryValue(writeOff?.value)) {
    return {
      ok: false,
      error: WRITE_OFF_SUBMIT_ERROR,
      fieldErrors: definition
        ? { [`attr-${definition.id}`]: [WRITE_OFF_SUBMIT_ERROR] }
        : undefined,
    };
  }

  return { ok: true };
}
