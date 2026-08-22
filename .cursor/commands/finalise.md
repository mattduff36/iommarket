# /finalise

This command authorizes local finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. Run `npm run finalise`.
3. Classify a deterministic failure repair from its own delta, not from the original feature lane. Type-narrowing, lint, test-fixture, and build-only repairs remain FAST/STANDARD.
4. For a safely repairable step, inspect `private/automation/finalise-last-failure.json`, fix the issue, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise` once for closure.
5. Never use generic repair for migration/database, commit, push, unknown, stale, or destructive steps. Stop for merge conflicts, missing access/environment, or production-data risk.
6. Do not apply Prisma or Supabase migrations as part of finalise.
