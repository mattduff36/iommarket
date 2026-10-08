# C–E staging rollout

This batch extends the A/B contract. It does not change payment acceptance, entitlements, authentication permissions, database schemas or the staging-to-main approval gate.

## Implemented boundaries

- Accounts: safe authentication mapping, expired link/session guidance, explicit existing signup disclosure policy, reliable signup wait times. Arbitrary provider text containing “try again” or “check” no longer passes through. Password character-set messages accept only recognized sets. Profile/deactivation exceptions use monitored outcome uncertainty.
- Dealer/admin: listing lifecycle, onboarding, cancellation, refund/reconciliation, account deletion and status, profile edit, costs, dealer configuration, regions, pages, settings, media and checklist catches retain known reasons and replace unexpected exceptions. Monitoring failure cannot mask the new shared fallback. Each fallback records safe public code, journey and operation kind through existing monitoring.
- Vehicle lookup: invalid registration, no match, timeout and temporary service failure are mapped by stable code. Partial-result warnings use the same mapping and cannot display raw provider/DB text. Dealer-logo client exceptions use an exact approved validation-message set.
- Privileged recovery: refund, subscription cancellation, user-administration changes, cancellation requests and catalogue imports lock the current operation after returned uncertainty or a rejected response. A full-page status link retrieves authoritative state before another attempt. Field validation remains correctable. Existing refund operation IDs are preserved.
- Shared presentation: form headings do not blame valid input or assert that an uncertain write failed. Page/global boundaries retain retry/home, add support, and display only a validated monitoring event reference. A new error clears the old reference. Offline status is a hint, not proof that a request never reached the server.

## Prevention and diagnostics

`__tests__/scripts/public-boundary-gate.test.ts` runs in the normal finalise test suite. The scanner flags raw exception-message response patterns and selected generic catch-all wording. Every exception is an exact file/snippet with an occurrence limit and an explicit reason in `reviewed-public-exceptions.json`; added duplicates are rejected too. This is a focused regression check, not a full information-flow proof. Future producers still require review, including indirect helpers, generated messages and validation schemas.

Unknown shared fallbacks use `captureException` tags `publicErrorCode`, `journey`, and `operationKind`. Triage repeated unknown groups in existing monitoring and add an allowlisted mapping only after establishing the cause. Do not log uploaded files, tokens or form payloads for this purpose. No second telemetry service is introduced.

## Evidence and remaining audit limits

Tests cover safe known reasons, hostile provider strings, monitoring failure, required retry timing, boundary support references and mutation locks. The release's exact full-suite and deployment evidence is recorded in the task handoff. Financial, deletion and import failure paths are tested with mocks; they must not be triggered against real customer records merely to demonstrate an error.

The original 3,369 candidate rows remain immutable provenance. Generated statuses identify migrated boundary functions; `deferred-c` and static-limit rows remain visible where this rollout has not established a function-level runtime trace. Many are internal diagnostics, unchanged validation or established typed domain errors. This release does not claim that every possible runtime error on the site has been exercised. Explicit exceptions preserve reviewed internal machine API messages, catalogue conflict explanations and existing private domain classes rather than converting useful reasons to generic copy.

Production requires the owner's separate approval. No database migration is required for this batch.
