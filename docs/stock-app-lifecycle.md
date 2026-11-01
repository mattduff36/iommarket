# Stock Update website lifecycle

The Stock Reviews page can open the installed Windows app, connect it to the current site and admin account, or close the selected connected instance safely. Offline scans and approvals ask for confirmation before queuing work. A temporary run receives only those job IDs and closes when processing ends. An existing manually opened instance stays open.

## Plan and boundaries

1. Issue a short-lived, one-use handoff from an authenticated, allowlisted admin action, bound to the current environment. Never place a session token in a launch URI.
2. Register the per-user `itrader-stock-update` Windows protocol in installer 1.1.11. Redeem only against the fixed preview or production origin. Preserve Preview as the default for manual launches.
3. Pass task IDs through stdin and filter the atomic database lease, preserving existing approval, fingerprint and lease fencing.
4. Drain active work before closing. Send a terminal authenticated disconnect; reject late heartbeats from retired instances. Stream presence updates to the visible webpage independently of report editing.
5. Verify native parsing/lifecycle, server authorization/scope, and browser confirmation/cancellation; deploy staging first and production through a staging-to-main PR. Publish the matching signed installer to both channels.

## Operation

Windows or the browser can require a one-time external-app prompt. The website cannot bypass this setting. New installations need the updated installer to register the protocol. A launch timeout does not retry queued mutations: the admin should inspect saved task status first.

Graceful exit sends a final disconnect and the site normally receives it within about a second. Crashes, forced process termination and network loss still use heartbeat expiry. The page updates connection status without a full reload, preserving review selections and edits.

Task completion is read from saved job results. A process exiting is not proof of success. An explicit close command targets the selected device and instance and waits for its active job to finish.

## DW Cars photo failure

The November 1 approval failed on an approved source photo returning HTTP 403 after two photos had staged. Explicit 403/404/410 source responses are now recorded as skipped progress. Other download/security/upload failures remain fatal. Every created vehicle must retain at least one valid imported photo; missing photos do not permit an empty listing or bypass plan validation.
