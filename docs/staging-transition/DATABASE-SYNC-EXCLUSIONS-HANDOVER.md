# Database sync exclusions - integrated for staging rollout

## Current owner-approved scope

Exclude preview packs, linked preview accounts/listings and dependent rows, all Waitlist tables, Monitoring tables, DealerPromotionCampaign, DealerOnboardingInvite and related events. Exclude User IDs cmusfwkh5000006pjpp1gnslj and cmus3bgau000004jjx43oid1l regardless of role. Administrator accounts are excluded. Existing staging records and linked Auth sessions are preserved.

## Implementation

- The copy catalog omits the excluded table families.
- No campaign, waitlist, monitoring or pack identity conflict comparisons run.
- Source rows owned by excluded users/dealers or referencing excluded parents are omitted using the actual foreign-key graph.
- Excluded destination identities are protected even when production has different IDs.
- Auth users and identities attached to exclusions are not imported or overwritten.
- Included source rows alone enter snapshot storage and unique-key checks.
- Inspection counts and schema compatibility omit excluded tables and unused enum definitions. Raw destination fingerprint still guards changes between prepare and apply.
- The manifest carries marketplace-exclusions-v1. Older prepared plans are rejected without modification.
- At apply time the destination scope is reread before backup/data writes to reject newly excluded rows or references.
- Full-database Replace, Reset and Restore are disabled because they can modify excluded records. Encrypted included-data backups and transaction rollback remain. Automatic scoped restoration is NOT implemented.

## Boundaries and checks

The previously blocked code-only integration was executed following explicit owner approval. No database lookup or data mutation was run during this integration. No tests or blocker investigation were performed. TypeScript completed with exit 0. Normal Vercel build must succeed before the deployment is described as live.

The shared workspace stays on staging. Only the exclusion implementation and this document belong in this commit. Existing ImageKit/admin-profile edits and stashes are not part of this task. Production main and hosted environment settings remain unchanged.

## Next action

Deploy the scoped source changes to staging through the normal Git/Vercel workflow, then record the READY deployment and exact commit locally. The owner must refresh the staging database page and prepare a NEW Merge preview. No shared-development Merge, Replace, Reset or Restore has been applied. A READY deployment is not a proven hosted merge.
