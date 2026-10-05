# Post-production follow-up — 5 October 2026

Deferred items only. None of these blocked the staging-to-production release.

## FlowPay admin refund controls

Normal `paymentProvider = DEV` FlowPay subscriptions can display the Ripple-oriented **Record portal refund** control.

`adminRefundSubscriptionPayment()` accepts that subscription because FlowPay stores a `sim_...` provider subscription ID. `sim_starter` and `sim_pro` are not Ripple products. The Ripple refund coverage path treats them as an unknown product and can cancel local sample coverage incorrectly.

Do not implement either option as part of the production release:

1. Hide or disable Ripple refund and portal controls for `DEV` records.
2. Design a separate FlowPay post-success refund simulator.

Succeeded one-off `DEV` payments can also display misleading **Manage in Ripple** wording.

## Ripple in-app refund capability

`supportsInAppRefunds` stays false. The claim/provider crash-concurrency prerequisite is still unresolved. In-app provider refunds remain disabled, so this does not block release.

## Local typecheck helper

The gitignored file `tmp/preview-deployment-target.ts` has an existing `NODE_ENV` / `ProcessEnv` mismatch. A whole-workspace typecheck can exit non-zero because of it. The file is not shipped and is not a production blocker.
