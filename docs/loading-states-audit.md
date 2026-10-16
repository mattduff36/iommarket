# Loading states audit and implementation

16 October 2026. Scope: all 108 application pages, navigation, asynchronous UI and large navigation menus. Release target: staging only.

## Findings

- Only vehicle-check had a route loading boundary. Dynamic pages therefore left the previous page visible until server rendering completed.
- Account/dealer chrome awaited `getCurrentUser`; admin layout awaited `isAdmin`. A loading file inside the same segment cannot cover that layout's own await.
- Sign-out awaited Supabase, then pushed home and refreshed the old route. Authenticated server content remained visible during that interval.
- Search filters and sorting initiated navigation without reporting that results were updating.
- Uploads, vehicle catalogue lookup, vehicle checks, action buttons and infinite-scroll results already had local pending feedback. Visitor map chunk loading already had a fallback. The lazy listing editor did not.
- Mobile menus had inconsistent, stronger backdrops. Small desktop dropdowns did not need a page overlay.

## Implemented plan

1. Use the supported Next Link `onNavigate` callback and React transitions, retaining Next prefetch, cancellation, new-tab, external-link and download behaviour. Shared Link and router adapters provide immediate feedback for existing navigation call sites. No Next internals, history patching, global click interception or extra network request.
2. Keep headers and navigation visible. Hide and make old content inert during cross-path navigation while a destination-shaped skeleton appears. Keep children mounted so pending navigation does not destroy local state. Within account/admin areas retain the sidebar; conceal the entire private area on sign-out or when leaving it.
3. Add inherited route loading boundaries for every page, with more specific cards, detail, form and table variants. Stream account/dealer chrome within Suspense; keep admin children behind the existing server authorization check within Suspense.
4. Keep same-path query updates visible with a small updating indicator. Keep existing local operation indicators, add waiting spinners to signup/payment confirmation and a lazy editor fallback. Reduced-motion settings stop new skeleton/spinner animation.
5. Conceal private content before starting sign-out. Handle returned and thrown auth errors. On success, navigate to sign-in as a fresh document to discard cached private server content. Never restore private content on a successful sign-out timeout; provide a safe sign-in recovery link.
6. Use a mild 25% black / 2px blur backdrop for burger/account/admin navigation sheets. Keep ordinary dropdowns lightweight and preserve dialog focus/escape handling.

## Route coverage

| Route family | Boundary / behaviour |
| --- | --- |
| Home, marketing, legal, FAQ, contact | Public inherited page skeleton; immediate destination skeleton for navigation |
| Search, categories, dealers | Card skeleton; same-path filter changes retain controls and show updating status |
| Listing and dealer detail | Detail skeleton for navigation; listing route boundary |
| Sign-in, signup, password reset | Form skeleton; existing button pending state |
| Account and dealer, including trade | Table skeleton plus Suspense for account chrome; existing authorization retained |
| Sell, checkout, pay | Form skeleton; existing mutations/payment state machines retained |
| Payment return | Page skeleton; existing explicit confirmation copy plus local spinner |
| Admin and nested pages | Table skeleton, streamed authorization gate, persistent header/sidebar |
| Staging access, early access, sample checkout | Form skeleton; existing form pending state |
| Holding and UI demo | Root inherited fallback; static content requires no artificial wait |

Native anchors intentionally remain for downloads, external sites, hash navigation, telephone/email links, and explicit full-document recovery/reload actions. Background account polling does not interrupt the page with a skeleton. No artificial minimum animation delay is added.

## Verification

Focused tests cover a suspended route transition, retained shell, hidden/inert previous content, transition completion, sign-out concealment and failure recovery, plus existing header/account/admin/menu tests. Required finalise checks and deployed staging browser checks are recorded in the release report. Browser acceptance includes a slowed connection, public and admin navigation, filter updates, mobile backdrop and sign-out. No payment, subscription, webhook, database schema or production release changes are included.
