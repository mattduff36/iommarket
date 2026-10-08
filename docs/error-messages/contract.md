# Public error contract

Stable types live in `lib/forms/public-error.ts`. Upload allowlisting lives in `lib/media/upload-error-catalog.ts`. Existing callers that only read `error` keep working.

## Payload

```ts
interface PublicErrorBody {
  error: string | FieldErrors; // legacy string or field map
  code: PublicErrorCode;
  retryable: boolean;
  retryAfterSeconds?: number; // integer 1..86400
  supportReference?: string; // monitoring eventId, [A-Za-z0-9_-]{8,80}
  fieldErrors?: FieldErrors; // present when `error` is also a string
}
```

Codes: `validation`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `expired`, `processing`, `rate_limited`, `unavailable`, `unknown`.

## Helpers for the listing and payment worker

- `publicErrorBody` / `publicFieldErrorBody` build the payload. `isRenderablePublicMessage` is a syntax guard (length, control characters, URL-like text). It is not a security allowlist. Callers must pass an approved sentence and keep a boundary allowlist. Unsafe messages are replaced with `publicFallbackMessage(code)`.
- The shared default for `unknown` is `retryable: false`. That default must not invite an automatic retry of an ambiguous write. The payment worker passes `retryable: false` explicitly for an uncertain charge and must not claim the customer was not charged.
- `splitActionError` and `readPublicActionError` understand this object. A plain string or field map is unchanged. Unrecognised objects still use the legacy "check your details" sentence; do not rely on that sentence for infrastructure failures.
- `readPublicErrorMeta` reads `code`, `retryable`, `retryAfterSeconds` and `supportReference` without changing the two-field split result.
- `rateLimitPublicError` in `lib/rate-limit-result.ts` adds wait time. `rateLimitActionError` still returns a string for current action callers.
- `withMonitoringReference(body, () => captureException(...))` appends a support reference only after capture returns a safe `eventId`. If capture throws or returns null, the original body is returned.

## Upload boundary already migrated

`app/api/listing-images/*`, `lib/images/client-upload.ts`, `lib/images/imagekit-client-upload.ts`, and `components/marketplace/image-upload.tsx`.

Known photo messages pass through `classifyUploadError`, which keeps the internal source string for recognition and returns the approved public sentence. Internal wording such as "Upload identity", "metadata could not be stripped", and provider names is not shown. Unknown and provider text become `We couldn't verify this photo right now. Try again shortly.` or `Photo verification is temporarily unavailable. Try again shortly.` They do not say the upload succeeded or that the file is invalid. Expired uploads say to select the photo again. A photo that is still being prepared says to wait briefly.

Do not migrate auth sitewide, admin, or `app/error.tsx` / `app/global-error.tsx` in the listing/payment change. Do not reuse photo copy for payment uncertainty.

## Listing save and checkout boundaries

`lib/listings/save-public-error.ts` allowlists trusted listing lifecycle sentences. Create, update, submit, and photo sync return `publicErrorBody` for an unexpected exception: outcome uncertain, `retryable: false`, support reference only when capture returns an event id. Missing and unauthorized listings share `This listing isn't available for that action.` Field maps stay field maps. Photo compare-and-swap still returns `conflict: true` and the latest `photoRevision`.

`lib/payments/checkout-public-error.ts` maps an exact thrown checkout code, or the exact Ripple amount sentence, to the existing configuration message. Any other checkout, simulator, or sample failure uses `We haven't confirmed the payment result yet. Check payment status before paying again.` with `retryable: false`. Return-page query text does not claim success, decline, or cancellation. Confirmed and failed wording comes from `readHostedCheckoutLink`.

Withdraw, report, contact, renew, charges, webhooks, refunds, and entitlements are unchanged.

## B recovery acceptance and deferred coverage

Unknown action responses and lost transport responses lock the current listing/payment mutation and offer a normal link to recorded status. Validation errors remain correctable. New-listing uncertainty points to My listings; listing checkout points to `/sell/checkout?listing=...`; Featured points to the listing; subscriptions point to the dealer dashboard. Sample checkout requires a full document reload from its status route. These controls do not replace server idempotency or assert that payment failed.

The wizard keeps mounted field values, routes photo failures to Photos and optional validation to the applicable optional group, and preserves photo revision/mutation handling. Existing UI components are reused. No new UI framework or error tracking service is added.

Regression coverage includes unknown returned payloads and rejected promises in `featured-upgrade-button`, `retry-checkout-button`, `subscribe-form`, `sample-checkout`, and `create-listing-submit` tests. Action tests reject authentication, database and rate-limit preconditions; recognized checkout errors survive monitoring failure. Full release checks supplement these focused tests.

Inventory status identifies migrated public boundaries, not a claim that every line in a mixed module changed. Listing withdraw/renew/report/contact/mark-sold owners remain C. `deferred-c-payment-internals` records provider plumbing, administrative subscription/refund paths and other payment-related modules outside customer checkout; they are not silently marked implemented. Known provider exceptions reaching B are mapped by B boundaries. The original 3,369 candidate provenance is retained; added B helpers are documented here. Static traces and source-drift exceptions are not runtime proof. C-E remain subject to the owner's next decision.
