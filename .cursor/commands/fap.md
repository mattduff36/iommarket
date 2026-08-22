# /fap

This command explicitly authorizes local finalisation, commit, and pushing the current branch.

1. State the current branch and a short summary of what will be pushed.
2. Check for an active Agent Review or finalise terminal and wait if one is running.
3. Run `npm run finalise:push`.
4. Classify a deterministic failure repair from its own delta, not from the original feature lane. Type-narrowing, lint, test-fixture, and build-only repairs remain FAST/STANDARD.
5. For a safely repairable step, inspect `private/automation/finalise-last-failure.json`, fix it, and run `npm run finalise:repair`. Repeat only that targeted check until stable, then run `npm run finalise:push` once for closure so the original push intent is preserved.
6. Never generically repair migration/database, commit, push, unknown, stale, or destructive steps. Stop for genuine blockers.
7. Do not apply Prisma or Supabase migrations as part of finalise.
