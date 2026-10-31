# Image upload investigation — 31 October 2026

## Findings and evidence

The batch-upload incident is an application rate-limit defect, not evidence of oversized photos or an ImageKit storage outage.

- The sell form supports 20 photos, and `/api/listing-images/intent` allows 20 requests per minute. The ImageKit finalization route allowed only 10 per minute. The component submitted the whole selection concurrently.
- Production Vercel request logs returned 48 HTTP 429 responses from `/api/listing-images/imagekit-finalize` between 10:47:50 and 11:48:58 UTC on 31 October. The focused 11:18–11:22 window contains 24 requests: 16 HTTP 200 and 8 HTTP 429. Request `txk86-1793445567770-2ec977d08ec4` is one example at 11:19:27.770 UTC.
- A failed upload intent issued at 11:19:25.647 remained `ISSUED` with no registered source file ID. A read-only ImageKit lookup found its private quarantine original, created at 11:19:27.406: 633,149 bytes, 2048×1536. Transfer succeeded; application verification did not run successfully. No customer files were modified or deleted during investigation.
- The limiter returns a sentence containing a wait duration. The upload message allowlist recognized only the original exact sentence, discarding the rate-limit code/wait and displaying the screenshot's generic verification error.
- The direct uploader made only one finalization request and then discarded its successful upload result on rejection. Smaller successive batches still shared the same minute-long allowance.
- The UI also held successful photos in pending slots until the entire selection settled. It reserved its upload lock only after asynchronous preflight, allowing overlapping selections during decoding.

Vercel's ordinary runtime-message search found no upload exceptions; request-level status logs supplied the evidence. An initial 24-hour runtime query was rejected by retention rules, not returned as a clean result. No claim is made that provider errors never occur.

## Separate DW Cars source failure

The 30 October 23:16:50 saved DW Cars review for the 2023 Nissan JUKE, 6,000 miles, references the dealer's own website before import. Its first source is `https://www.dwcars.info/images/carpix/details/slider_06751.jpg`.

Read-only probes repeatedly returned HTTP 403, `server: cloudflare`, `cf-mitigated: challenge`, and an HTML “Just a moment...” page. The other 13 full-size source photos returned HTTP 200 images; the corresponding `horizontal_06751.jpg` thumbnail also returned HTTP 200. This is a source-site access challenge, separate from ImageKit.

The review previously rendered only the first URL with no fallback. The importer requires approved source images and fails closed on a download failure. Showing another thumbnail does not repair the external source or authorize silently dropping an approved image. The pending report and its fingerprint remain unchanged; its inaccessible source should be reviewed before approval. The source site's challenge was not bypassed.

## Fix

- Align ImageKit verification with the existing 20-intent/minute allowance. Authentication, origin, ownership, identity, expiry and server-side byte/privacy checks remain enforced; requests beyond the allowance still return 429.
- Limit preflight and uploads to three concurrent operations, retain file-selection order, and reserve capacity before preflight.
- Retry rejected intent requests on 429, respecting `Retry-After`. Do not retry ambiguous intent creation or replay a one-use ImageKit upload token.
- Retry idempotent finalization for throttling, transient server responses and lost responses using the same intent/file IDs. Cap at four attempts and 180 seconds of response-directed backoff. Respect terminal/non-retryable errors and excessive requested waits.
- Recognize only the bounded approved rate-limit sentence pattern, preserving the safe message, retry classification and wait duration.
- Try the same vehicle's remaining safe review photos after an image error; keep the link aligned with the displayed image and show a warning to check source photos before approval. Show an explicit unavailable state if all candidates fail.

## Verification

Four newly introduced regressions failed against the original implementation: 20-photo route capacity, verification 429 recovery, lost-response recovery, and bounded batch concurrency. They passed after the fix.

Targeted route/client/component checks passed (41 tests at the first combined checkpoint); the subsequent preflight-overlap regression also passed. Chromium and Firefox each completed two 20-photo batches with injected intent 429, finalization 429 and finalization 503 responses: 40 raw uploads, 41 intent attempts, 44 verification attempts, peak concurrency three, preserved order, working source fallback and no browser page errors. These browser checks used the actual components/client code with mocked network endpoints; they did not create production listings or perform a live 40-file provider load test.

Type checking and lint passed. The first full run passed 4,036 tests and failed only the generated error-message register's source-drift check. The existing generator refreshed 20 inventory entries without changing the 3,369-row provenance; the inventory check then passed. Final full-suite and build evidence is retained with the release handoff.

Private, ignored evidence: `tmp/imagekit-incident-20261031/` contains the request logs, incident summary, provider/source probes, before/after regression output, full checks, browser harness/results and screenshots. Do not publish environment files, signed URLs, private file identities or raw customer records.

## Release boundary

Prepare and verify staging first. Production requires an approved staging-to-main pull request. This audit does not authorize production report edits, asset deletion, provider configuration changes or bypassing source-site access controls.
