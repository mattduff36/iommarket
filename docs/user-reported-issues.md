# User-reported issues

Users can report displayed errors using the adjacent **Report issue** button. Reports create a MEDIUM monitoring event tagged `user-reported`, grouped by route and error message. Monitoring retains its existing recipient, severity, cooldown and email-template settings; a click does not promise an immediate email. A successful response displays the stored event reference.

Coverage includes shared alerts, error toasts, field validation, upload slots, fatal error fallbacks, vehicle lookups, and inline public/dealer/admin operation errors. Informational notices, successful operations, required-field stars and account status badges are not errors. New inline errors should use `ReportableError` (or the shared `Alert` with `status="error"`); ordinary HTML error messages do not automatically acquire a button.

The controls are rendered by React, including during server rendering. A DOM observer approach was rejected after a deferred-hydration regression reproduced a mismatch. The replacement passes that regression in Chromium and Firefox and has a committed hydration test.

Reports contain the displayed error, pathname, optional existing support reference, and server-derived account identity. Form controls, hidden content and action links are excluded; URL queries and recognized sensitive text are redacted. The endpoint requires same-origin JSON, validates and bounds its body, rate-limits submissions, ignores client-supplied identity/severity and confirms success only after persistence. Anonymous error screens are supported. Retries and repeated identical reports reuse an ID, with persistence-level deduplication and existing notification delivery tested separately.

Browser acceptance checks cover failure/retry, duplicate errors, successful reference feedback, text changes/removal, delayed hydration, and omission of form values/query strings. Requests are mocked to avoid generating administrator email during verification. No production report or customer session is manufactured.
