# Part 2 implementation — 23 November 2026

Owner authorised implementation from `itrader-part2-answers (1).json`.

1. Admin analytics only: use complete Europe/London calendar days, ending at the start of today. Bound database activity and Google Analytics to the same interval, including previous-period comparisons and daylight-saving changes. Label current marketplace counts and lifetime rankings explicitly; do not invent historical snapshots. Other pages keep their current behaviour.
2. Opening hours: optional for all dealer tiers. Add validated weekly hours and an on/off setting to dealer profiles, with public display only when enabled and valid. Record Google Business source and verification date when importing. Seed current real dealer accounts only where the correct business and hours can be verified; otherwise leave disabled. Owners can correct their schedule or turn it off. Do not overwrite an existing manually edited schedule during import.
3. Manx Car Warehouse: compare existing failed-job evidence and current source behaviour; reproduce the failure where possible. Fix only an evidenced cause, preserve blocked-vehicle and incomplete-scrape safeguards, and state any laptop-specific verification limit.

Verification: focused timezone/boundary and validation/authorisation tests, connector regression where justified, registered release gates, and signed-in staging browser checks. Additive database migration on staging; production remains subject to owner approval.

Coordination: `Check Linux Worker Test access` owns Oracle pairing/live acceptance and worker lifecycle files. This chat owns analytics, opening hours and any MCW-specific connector fix. Coordinate staging pushes and worker-related changes before applying them. One canonical checkout, no MPDEE Worker for this task.

## Implementation evidence

- Added completed-day range tests across GMT/BST transitions and page-level assertions for the SQL and Google Analytics upper bounds. Current marketplace counts remain explicitly labelled Current.
- Added optional hours to every dealer tier, including Closed, By appointment, split periods and Open 24 hours. Public profiles hide disabled or invalid schedules. Owner edits clear imported source provenance when the schedule changes.
- Applied migration `20261123003000_dealer_opening_hours` to staging only. Imported the full Google Business weekly schedule for all 14 active real dealer accounts on 23 November 2026. Source URL and verification date are retained per account; the guarded import does not overwrite an existing schedule. Private replay data and evidence: `private/part1/verified-opening-hours.json` and `private/part1/part2-hours-import.log`.
- Google lists Manx Car Warehouse as open 24 hours seven days a week. This has been copied as requested and needs owner review before production. Mike's Motors is listed as closed on Wednesdays; Jacksons lists Monday opening at 09:00 and Tuesday–Friday at 08:00.
- MCW investigation: four production failures on 22 November contain only `source-failed` and a zero count, without an underlying browser/network error. A subsequent scan and apply succeeded with 18 vehicles. Current read-only probes using both the configured browser preference and HTTP extraction returned the same 18 vehicle identities, with no pagination uncertainty. This does not reproduce or identify DM's laptop failure. No speculative connector or worker-lifecycle change was made. Private results: `private/part1/mcw-current-true.json` and `private/part1/mcw-current-false.json`.

## Staging acceptance

1. On `/admin/analytics`, check 7/30/90-day ranges end yesterday in Isle of Man time; the charts omit today and current totals are labelled Current.
2. Open dealer profiles (including Ingear's Starter account) and check the seven-day hours against Google. Review the unusual MCW, Mike's Motors and Jacksons entries above.
3. In a dealer's My Profile, edit hours, save and reload; switch display off and confirm the public hours disappear. Switch it back on to restore display. No tier upgrade should be required.
4. Retry MCW on DM's laptop when available. A successful server probe is not proof the laptop issue is fixed; preserve the laptop error/log if it fails again.

Production deployment and migration require owner approval after staging review. The prior Part 1 approval does not cover this release.
