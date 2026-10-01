import type { Prisma } from "@prisma/client";
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

export function applySamplePaymentVisibility(
  where: Prisma.PaymentWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.PaymentWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample) },
    ],
  };
}

export function applySampleReportVisibility(
  where: Prisma.ReportWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ReportWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample) },
    ],
  };
}

export function applySampleListingImageVisibility(
  where: Prisma.ListingImageWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ListingImageWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample) },
    ],
  };
}

export function applySampleSubscriptionVisibility(
  where: Prisma.SubscriptionWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.SubscriptionWhereInput {
  if (sample.dealerListings) return where;
  return {
    AND: [
      where,
      { dealer: applySampleDealerVisibility({}, sample) },
    ],
  };
}

export function applySampleDealerReviewVisibility(
  where: Prisma.DealerReviewWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.DealerReviewWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { dealer: applySampleDealerVisibility({}, sample) },
      {
        OR: [
          { reviewerUserId: null },
          { reviewer: applySampleUserVisibility({}, sample) },
        ],
      },
    ],
  };
}

export function applySampleReviewResponseRevisionVisibility(
  where: Prisma.DealerReviewResponseRevisionWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.DealerReviewResponseRevisionWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      {
        response: {
          review: applySampleDealerReviewVisibility({}, sample),
        },
      },
    ],
  };
}

export function applySampleReviewDisputeVisibility(
  where: Prisma.DealerReviewDisputeWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.DealerReviewDisputeWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { review: applySampleDealerReviewVisibility({}, sample) },
    ],
  };
}

export function applySampleCancellationVisibility(
  where: Prisma.DealerCancellationRequestWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.DealerCancellationRequestWhereInput {
  if (sample.dealerListings) return where;
  return {
    AND: [
      where,
      { dealer: applySampleDealerVisibility({}, sample) },
    ],
  };
}

export function applySampleFavouriteVisibility(
  where: Prisma.FavouriteWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.FavouriteWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample) },
      { user: applySampleUserVisibility({}, sample) },
    ],
  };
}

export function applySampleListingViewVisibility(
  where: Prisma.ListingViewWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ListingViewWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { listing: applySampleListingVisibility({}, sample) },
      {
        OR: [
          { viewerId: null },
          { viewer: applySampleUserVisibility({}, sample) },
        ],
      },
    ],
  };
}

export function applySampleSavedSearchVisibility(
  where: Prisma.SavedSearchWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.SavedSearchWhereInput {
  if (!hidesAnySamples(sample)) return where;
  return {
    AND: [
      where,
      { user: applySampleUserVisibility({}, sample) },
    ],
  };
}
