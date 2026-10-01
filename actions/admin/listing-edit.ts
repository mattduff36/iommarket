"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { reportHandledException } from "@/lib/monitoring";
import { validateListingAttributesWithServerPolicy } from "@/lib/listings/listing-ns-policy";
import { listingDetailsSchema } from "@/lib/validations/listing";

const listingIdSchema = z.string().cuid();

const adminListingEditSchema = listingDetailsSchema
  .pick({
    title: true,
    description: true,
    price: true,
    categoryId: true,
    regionId: true,
  })
  .extend({
    listingId: listingIdSchema,
    expectedLifecycleRevision: z.number().int().min(0),
    expectedUpdatedAt: z.string().datetime(),
    attributes: z
      .array(
        z
          .object({
            attributeDefinitionId: z.string().trim().min(1).max(100),
            value: z.string().trim().min(1),
          })
          .strict(),
      )
      .max(100)
      .superRefine((attributes, context) => {
        const seen = new Set<string>();
        attributes.forEach((attribute, index) => {
          if (seen.has(attribute.attributeDefinitionId)) {
            context.addIssue({
              code: "custom",
              path: [index, "attributeDefinitionId"],
              message: "Each listing attribute can appear only once.",
            });
          }
          seen.add(attribute.attributeDefinitionId);
        });
      }),
  })
  .strict();

type AdminListingEditInput = z.infer<typeof adminListingEditSchema>;

export async function loadAdminListingForEdit(input: unknown) {
  await requireRole("ADMIN");
  const parsedId = listingIdSchema.safeParse(input);
  if (!parsedId.success) return { error: "Invalid listing." };

  const listing = await db.listing.findUnique({
    where: { id: parsedId.data },
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      status: true,
      categoryId: true,
      regionId: true,
      lifecycleRevision: true,
      updatedAt: true,
      attributeValues: {
        select: { attributeDefinitionId: true, value: true },
      },
      _count: { select: { images: true } },
    },
  });
  if (!listing) return { error: "Listing not found." };

  const [categories, regions, openRevision] = await Promise.all([
    db.category.findMany({
      where: { OR: [{ active: true }, { id: listing.categoryId }] },
      orderBy: { sortOrder: "asc" },
      include: {
        attributeDefinitions: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.region.findMany({
      where: { OR: [{ active: true }, { id: listing.regionId }] },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    db.listingRevision.findFirst({
      where: { listingId: listing.id, status: { in: ["DRAFT", "PENDING"] } },
      select: { id: true, status: true },
    }),
  ]);

  return {
    data: {
      listing: {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        price: listing.price,
        status: listing.status,
        categoryId: listing.categoryId,
        regionId: listing.regionId,
        lifecycleRevision: listing.lifecycleRevision,
        updatedAt: listing.updatedAt.toISOString(),
        attributes: listing.attributeValues,
        photoCount: listing._count.images,
      },
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        attributes: category.attributeDefinitions.map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          slug: attribute.slug,
          dataType: attribute.dataType,
          required: attribute.required,
          options: attribute.options,
        })),
      })),
      regions,
      hasOpenRevision: Boolean(openRevision),
      openRevisionStatus: openRevision?.status ?? null,
    },
  };
}

export async function saveAdminListingEdit(input: unknown) {
  const admin = await requireRole("ADMIN");
  const parsed = adminListingEditSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<{ id: string; lifecycleRevision: number; updatedAt: Date }>
      >`
        SELECT "id", "lifecycleRevision", "updatedAt"
        FROM "Listing"
        WHERE "id" = ${parsed.data.listingId}
        FOR UPDATE
      `;
      if (!locked) return { error: "Listing not found." };

      if (
        locked.lifecycleRevision !== parsed.data.expectedLifecycleRevision ||
        locked.updatedAt.getTime() !==
          new Date(parsed.data.expectedUpdatedAt).getTime()
      ) {
        return {
          error: "This listing changed while the editor was open. Reload and try again.",
          conflict: true,
        };
      }

      const [listing, openRevision, category, region] = await Promise.all([
        tx.listing.findUnique({
          where: { id: parsed.data.listingId },
          select: {
            id: true,
            title: true,
            description: true,
            price: true,
            categoryId: true,
            regionId: true,
            lifecycleRevision: true,
            updatedAt: true,
            attributeValues: {
              select: { attributeDefinitionId: true, value: true },
            },
          },
        }),
        tx.listingRevision.findFirst({
          where: {
            listingId: parsed.data.listingId,
            status: { in: ["DRAFT", "PENDING"] },
          },
          select: { id: true },
        }),
        tx.category.findUnique({
          where: { id: parsed.data.categoryId },
          select: {
            id: true,
            slug: true,
            active: true,
            attributeDefinitions: {
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
        }),
        tx.region.findUnique({
          where: { id: parsed.data.regionId },
          select: { id: true, active: true },
        }),
      ]);
      if (!listing) return { error: "Listing not found." };
      if (openRevision) {
        return {
          error:
            "This listing has a seller revision waiting for review. Resolve it before editing the live listing.",
          conflict: true,
        };
      }
      if (!category || (!category.active && category.id !== listing.categoryId)) {
        return { error: { categoryId: ["Choose an active category."] } };
      }
      const definitionIds = new Set(
        category.attributeDefinitions.map((definition) => definition.id),
      );
      if (
        parsed.data.attributes.some(
          (attribute) => !definitionIds.has(attribute.attributeDefinitionId),
        )
      ) {
        return { error: "One or more attributes do not belong to this category." };
      }
      if (!region || (!region.active && region.id !== listing.regionId)) {
        return { error: { regionId: ["Choose an active region."] } };
      }

      const attributeValidation = validateListingAttributesWithServerPolicy({
        categorySlug: category.slug,
        definitions: category.attributeDefinitions,
        attributes: parsed.data.attributes,
      });
      if (attributeValidation.configurationError) {
        return { error: attributeValidation.configurationError };
      }
      if (Object.keys(attributeValidation.fieldErrors).length > 0) {
        return { error: attributeValidation.fieldErrors };
      }

      const nextAttributes = attributeValidation.sanitizedAttributes;
      const previousAttributes = listing.attributeValues
        .map(({ attributeDefinitionId, value }) => ({ attributeDefinitionId, value }))
        .sort((a, b) => a.attributeDefinitionId.localeCompare(b.attributeDefinitionId));
      const sortedNextAttributes = [...nextAttributes].sort((a, b) =>
        a.attributeDefinitionId.localeCompare(b.attributeDefinitionId),
      );
      const changedFields = getChangedFields(listing, parsed.data, {
        previous: previousAttributes,
        next: sortedNextAttributes,
      });
      if (Object.keys(changedFields).length === 0) {
        return {
          data: {
            listingId: listing.id,
            unchanged: true,
            lifecycleRevision: listing.lifecycleRevision,
            updatedAt: listing.updatedAt.toISOString(),
          },
        };
      }

      const updated = await tx.listing.updateMany({
        where: {
          id: listing.id,
          lifecycleRevision: parsed.data.expectedLifecycleRevision,
          updatedAt: new Date(parsed.data.expectedUpdatedAt),
        },
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          price: parsed.data.price,
          categoryId: parsed.data.categoryId,
          regionId: parsed.data.regionId,
          lifecycleRevision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        return {
          error: "This listing changed while the editor was open. Reload and try again.",
          conflict: true,
        };
      }

      await tx.listingAttributeValue.deleteMany({ where: { listingId: listing.id } });
      if (sortedNextAttributes.length > 0) {
        await tx.listingAttributeValue.createMany({
          data: sortedNextAttributes.map((attribute) => ({
            listingId: listing.id,
            ...attribute,
          })),
        });
      }

      const updatedListing = await tx.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { lifecycleRevision: true, updatedAt: true },
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "ADMIN_EDIT_LISTING_DETAILS",
          entityType: "Listing",
          entityId: listing.id,
          details: { changedFields },
        },
        tx,
      );

      return {
        data: {
          listingId: listing.id,
          unchanged: false,
          lifecycleRevision: updatedListing.lifecycleRevision,
          updatedAt: updatedListing.updatedAt.toISOString(),
        },
      };
    });

    if ("data" in result && result.data && !result.data.unchanged) {
      revalidatePath(`/listings/${parsed.data.listingId}`);
      revalidatePath("/admin/listings");
      revalidatePath("/search");
      revalidatePath("/");
      revalidatePath("/account/listings");
      revalidatePath("/dealer/dashboard");
    }
    return result;
  } catch (error) {
    await reportHandledException({
      error,
      action: "saveAdminListingEdit",
      route: `/admin/listings/${parsed.data.listingId}/edit`,
      userId: admin.id,
    });
    return { error: "Unable to save listing changes. Refresh and try again." };
  }
}

function getChangedFields(
  current: {
    title: string;
    description: string;
    price: number;
    categoryId: string;
    regionId: string;
  },
  next: Pick<AdminListingEditInput, "title" | "description" | "price" | "categoryId" | "regionId">,
  attributes: {
    previous: Array<{ attributeDefinitionId: string; value: string }>;
    next: Array<{ attributeDefinitionId: string; value: string }>;
  },
) {
  const changedFields: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of ["title", "description", "price", "categoryId", "regionId"] as const) {
    if (current[field] !== next[field]) {
      changedFields[field] = { before: current[field], after: next[field] };
    }
  }
  if (JSON.stringify(attributes.previous) !== JSON.stringify(attributes.next)) {
    changedFields.attributes = {
      before: attributes.previous,
      after: attributes.next,
    };
  }
  return changedFields;
}
