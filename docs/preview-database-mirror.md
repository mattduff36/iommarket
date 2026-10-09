# Preview database mirror

`https://itrader.dev/admin/database` has one admin-only refresh action. It replaces every public application table and the production login accounts (`auth.users`, `auth.identities`, and `auth.mfa_factors`) in a single preview transaction. No preview user or administrator is retained. Password hashes and identities are copied exactly. Existing preview sessions and authentication audit/runtime records are cleared; production sessions are never imported. Sign in again using the production account credentials after refreshing.

Production is accessed only through an explicitly verified `REPEATABLE READ READ ONLY` transaction. The session default is also read-only because Supavisor can ignore startup options. Source SQL passes a second SELECT/SHOW guard. No production schema, grants, rows or configuration are modified. The source and destination Supabase projects are pinned independently of request inputs.

Schema drift, unsupported populated authentication features, mismatched application table catalogs, oversized snapshots, and concurrent refreshes fail closed. All copied tables are read back and their complete contents compared before commit. Foreign-key settings are restored before commit. Any failure before commit rolls back the replacement. A lost commit response requires checking the saved run status before retrying.

The Supabase project configuration, auth platform migration history, extensions, storage service and environment credentials remain environment-specific. Uploaded object bytes are not a database backup. Copied production records and their email, payment and media references are registered separately so staging cannot send messages, charge/refund payments or delete production media through the existing external-effect guards.

## Automatic refresh

The preview-only Supabase cron job `preview-production-mirror-72h` checks once per minute. It dispatches a refresh only when 72 hours have elapsed since the latest successful refresh, including a manual refresh. Failed dispatches retry no more frequently than every 15 minutes. It runs in the hosted database and does not depend on a developer computer or a production Vercel cron.

The scheduler sends an HMAC signed, timestamped POST to `/api/cron/preview-mirror`. Signatures expire after five minutes. The endpoint independently checks the staging environment, signature and 72-hour due time. The long-lived signing secret stays in Supabase Vault and the branch-scoped Vercel secret; it is never placed in pg_net request headers. See [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions) and [pg_net queue credential visibility](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357).

## Installation and recovery

The SQL files in `scripts/preview-mirror` are explicit preview-only operational setup, not application migrations. Verify the destination session connection, begin a transaction, and set `preview_mirror.install_target` to the pinned preview project reference before executing them. Install the signing secret with a parameterized `vault.create_secret` call named `preview_mirror_cron_secret`. The scheduler installs paused; activate it only after verifying the deployed route. Never run these scripts on production.

Staging branch secrets: `PREVIEW_MIRROR_SOURCE_READONLY_URL`, `PREVIEW_MIRROR_ENCRYPTION_KEY` (32-byte hexadecimal AES key), and `PREVIEW_MIRROR_CRON_SECRET`. The source uses the existing database login but every source transaction is explicitly read-only; its name is not a claim of separate database-role grants. Verified database TLS uses `SUPABASE_DB_CA_CERT`.

Each successful refresh retains an encrypted pre-replacement snapshot in `preview_mirror.runs`; only the latest three are retained. These are AES-256-GCM encrypted gzip JSON: nonce (12 bytes), tag (16 bytes), ciphertext; the run UUID is authenticated additional data. Decrypt with the branch encryption key and verify before any recovery. The initial full and public database backups are independently saved locally with Windows CurrentUser DPAPI encryption and SHA-256 verification. Neither private schema nor encrypted backups are exposed to anonymous/authenticated API users. Old database merge/reset/restore server actions are retired and fail closed.

Operational checks: inspect `preview_mirror.state` and the latest run verification summaries; inspect cron job state and `net._http_response` using the saved request ID. Avoid logging account rows, passwords, connection strings, secrets or queued authentication headers.
