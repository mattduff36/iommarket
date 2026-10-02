# Monitoring runbook

The operational queue is `/admin/monitoring`. Vercel Web Analytics and Vercel error alerts are the only external observability tools. Sentry is not used.

## What is stored

- Issues group repeated failures by fingerprint. Events keep the recent occurrence, route, request ID, masked email, IP hash, stack, and sanitized tags.
- Alert deliveries record email and webhook attempts. Suppressed repeats increment counters instead of writing one skipped row per event.
- Detailed events and completed deliveries are removed after 90 days. Resolved issue summaries are removed after 12 months. Generated prompts are cleared with the 90-day detail window.
- Account deletion also removes that user's monitoring events and scrubs issue text, prompts, and alert payloads that contain the email address.
- Visitor analytics run only after cookie consent. Page URLs sent to Vercel have query strings and hashes removed. Custom event properties cannot contain email, name, message, or token fields.

## Alerts

- Critical issues alert immediately and ignore the repeat cooldown.
- High issues alert immediately, then respect the configured cooldown.
- Acknowledged issues stay quiet until the severity increases or the same issue returns after six quiet hours.
- Mute expiry reopens the issue. An expired mute does not need a page view before alerts can resume.
- Resolved issues reopen and alert again on the next occurrence.
- Lower severities are summarized in a digest about once a day.
- Webhooks must be public HTTPS URLs. Payloads are signed as `t=<unix-ms>,v1=<hmac>` in `X-IOM-Monitoring-Signature` using `MONITORING_ALERT_WEBHOOK_SECRET`. Delivery fails closed when the secret or destination is unsafe. Redirects are not followed.

## Independent Vercel alert

Create a production error-anomaly or runtime error alert in the Vercel project and send it to an address that does not depend on this app's database. Then set `VERCEL_OBSERVABILITY_ALERTS_CONFIGURED=1`. Check the current reading with:

```bash
npx tsx scripts/monitoring/configure-vercel-alerts.ts
```

The admin health panel shows the last result. A database outage can still be visible through the Vercel alert and the structured `monitoringFallback` log line.

## Maintenance

`/api/cron/monitoring-maintenance` runs every five minutes. It retries the alert outbox, expires mutes, and once a day sends the digest, runs the capture canary, applies retention, and checks the Vercel fallback. Set `MONITORING_CANARY_SEND=1` only when a real daily canary email is wanted. Otherwise the canary verifies capture and alert enqueue without sending.

Apply `prisma/migrations/20261002150000_monitoring_hardening` before deploying this code. Do not apply it automatically from the finalise command.

## Fixing issues

`npm run fixerrors` exports open issues and a decision manifest. Fast, standard, and guarded clusters can be fixed, reviewed, and locally committed by the operator-invoked workflow. Critical and report-only clusters pause. The workflow never pushes.

## Rollout

1. Deploy the capture and instrumentation fix first and confirm new server errors reach the queue.
2. Deploy durable alerts and confirm a failed webhook remains retryable.
3. Deploy the admin workspace and analytics events.
4. Enable the maintenance cron after the migration is applied.
5. Turn on the Vercel fallback alert before relying on the in-app pipeline alone.

Rollback switches are `MONITORING_CAPTURE_SERVER=false` and removal of the alert recipient settings. Those stop new capture or notifications without deleting existing issues.
