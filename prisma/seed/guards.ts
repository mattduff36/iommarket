import {
  BLOCKING_DELETION_JOB_STATUSES,
  REPLAYABLE_INBOX_STATUSES,
  WIPE_HOLD_ENTITY_TYPES,
} from "./constants";

export function isReplayableInboxStatus(status: string) {
  return (REPLAYABLE_INBOX_STATUSES as readonly string[]).includes(status);
}

export function isBlockingDeletionJobStatus(status: string) {
  return (BLOCKING_DELETION_JOB_STATUSES as readonly string[]).includes(status);
}

export function holdIntersectsWipe(input: {
  entityType: string;
  releasedAt?: Date | null;
}) {
  if (input.releasedAt) return false;
  return (WIPE_HOLD_ENTITY_TYPES as readonly string[]).includes(input.entityType);
}

export function assertSeedGuards(input: {
  holds: Array<{ entityType: string; releasedAt?: Date | null }>;
  inboxStatuses: string[];
  preservedDeletionJobs: Array<{ userId: string; status: string }>;
}) {
  const intersectingHold = input.holds.find((hold) => holdIntersectsWipe(hold));
  if (intersectingHold) {
    throw new Error(
      `Refusing to seed: unreleased legal hold on ${intersectingHold.entityType}.`,
    );
  }

  const replayable = input.inboxStatuses.find(isReplayableInboxStatus);
  if (replayable) {
    throw new Error(
      `Refusing to seed: replayable PaymentWebhookInbox status ${replayable}.`,
    );
  }

  const blockingJob = input.preservedDeletionJobs.find((job) =>
    isBlockingDeletionJobStatus(job.status),
  );
  if (blockingJob) {
    throw new Error(
      `Refusing to seed: preserved user ${blockingJob.userId} has an active deletion job.`,
    );
  }
}
