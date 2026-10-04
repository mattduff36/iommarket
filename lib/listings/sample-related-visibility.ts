import type { Prisma } from "@prisma/client";
import { previewPacksVisibleOnFrontend } from "@/lib/preview-packs/frontend-visibility";
import {
  applySampleDealerVisibility,
  applySampleListingVisibility,
  applySampleUserVisibility,
  DEFAULT_SAMPLE_VISIBILITY,
  type SampleVisibility,
} from "./sample-visibility";

function hidesAnySamples(sample: SampleVisibility) {
  return !sample.privateListings || !sample.dealerListings;
}

function keepsRelatedRows(
  sampleScoped: boolean,
  env: NodeJS.ProcessEnv,
) {
  return !sampleScoped && previewPacksVisibleOnFrontend(env);
}

export function applySamplePaymentVisibility(
  where: Prisma.PaymentWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.PaymentWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample, env) },
    ],
  };
}

export function applySampleReportVisibility(
  where: Prisma.ReportWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.ReportWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample, env) },
    ],
  };
}

export function applySampleListingImageVisibility(
  where: Prisma.ListingImageWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.ListingImageWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample, env) },
    ],
  };
}

export function applySampleSubscriptionVisibility(
  where: Prisma.SubscriptionWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.SubscriptionWhereInput {
  if (keepsRelatedRows(!sample.dealerListings, env)) return where;
  return {
    AND: [
      where,
      { dealer: applySampleDealerVisibility({}, sample, env) },
    ],
  };
}

export function applySampleDealerReviewVisibility(
  where: Prisma.DealerReviewWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.DealerReviewWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { dealer: applySampleDealerVisibility({}, sample, env) },
      {
        OR: [
          { reviewerUserId: null },
          { reviewer: applySampleUserVisibility({}, sample, env) },
        ],
      },
    ],
  };
}

export function applySampleReviewResponseRevisionVisibility(
  where: Prisma.DealerReviewResponseRevisionWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.DealerReviewResponseRevisionWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      {
        response: {
          review: applySampleDealerReviewVisibility({}, sample, env),
        },
      },
    ],
  };
}

export function applySampleReviewDisputeVisibility(
  where: Prisma.DealerReviewDisputeWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.DealerReviewDisputeWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { review: applySampleDealerReviewVisibility({}, sample, env) },
    ],
  };
}

export function applySampleCancellationVisibility(
  where: Prisma.DealerCancellationRequestWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.DealerCancellationRequestWhereInput {
  if (keepsRelatedRows(!sample.dealerListings, env)) return where;
  return {
    AND: [
      where,
      { dealer: applySampleDealerVisibility({}, sample, env) },
    ],
  };
}

export function applySampleFavouriteVisibility(
  where: Prisma.FavouriteWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.FavouriteWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample, env) },
      { user: applySampleUserVisibility({}, sample, env) },
    ],
  };
}

export function applySampleListingViewVisibility(
  where: Prisma.ListingViewWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.ListingViewWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample, env) },
      {
        OR: [
          { viewerId: null },
          { viewer: applySampleUserVisibility({}, sample, env) },
        ],
      },
    ],
  };
}

export function applySampleSavedSearchVisibility(
  where: Prisma.SavedSearchWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.SavedSearchWhereInput {
  if (keepsRelatedRows(hidesAnySamples(sample), env)) return where;
  return {
    AND: [
      where,
      { user: applySampleUserVisibility({}, sample, env) },
    ],
  };
}
