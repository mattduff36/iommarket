# Client Flow Diagrams

This document is designed for client review and collaborative edits.  
Each Mermaid block can be copied into Mermaid Live Editor.

Important: Mermaid Live Editor cannot parse this whole markdown file at once.
Paste only one Mermaid diagram block at a time, or open one of the standalone `.mmd` files listed below.

Mermaid editor: https://mermaid.ai/live/edit

## How To Use

1. Use one of these standalone Mermaid files:
   - `docs/client-flow-master.mmd`
   - `docs/client-flow-auth.mmd`
   - `docs/client-flow-listing-lifecycle.mmd`
   - `docs/client-flow-discovery.mmd`
   - `docs/client-flow-payments.mmd`
   - `docs/client-flow-waitlist.mmd`
2. Paste the content of a single `.mmd` file into Mermaid Live Editor.
3. Edit node labels or arrows during review.
4. Keep `Current` and `FutureGap` labels so implemented vs planned paths stay clear.
5. If using this markdown file directly, copy only from ```mermaid to ``` for one section.

---

## Master Diagram - Platform Runtime Overview

```mermaid
flowchart TD
  Visitor[Visitor]
  Buyer[Buyer]
  Seller[Seller]
  Dealer[Dealer]
  Admin[Admin]

  subgraph publicApp [PublicApp]
    Home[HomeOrHolding]
    Search[SearchAndBrowse]
    ListingDetail[ListingDetail]
    SellFlow[SellCreateListing]
    Account[AccountArea]
  end

  subgraph adminApp [AdminApp]
    AdminConsole[AdminDashboard]
    Moderation[ListingModeration]
    WaitlistAdmin[WaitlistAdmin]
  end

  subgraph externalServices [ExternalServices]
    Supabase[SupabaseAuth]
    Ripple[RippleHostedCheckout]
    Resend[ResendEmail]
    Cloudinary[CloudinaryUploads]
  end

  subgraph dataLayer [DataLayer]
    Postgres[(PostgresViaPrisma)]
  end

  Visitor -->|"Current"| Home
  Home -->|"Current"| Search
  Buyer -->|"Current"| Search
  Search -->|"Current"| ListingDetail
  Seller -->|"Current"| SellFlow
  Seller -->|"Current"| Account
  Dealer -->|"Current"| SellFlow
  Admin -->|"Current"| AdminConsole

  Home -->|"Current"| Supabase
  Account -->|"Current"| Supabase
  SellFlow -->|"Current"| Cloudinary
  SellFlow -->|"Current"| Ripple
  SellFlow -->|"Current"| Postgres
  Search -->|"Current"| Postgres
  ListingDetail -->|"Current"| Resend
  AdminConsole -->|"Current"| Postgres
  WaitlistAdmin -->|"Current"| Postgres
  Ripple -->|"Current"| Postgres

  SellFlow -->|"FutureGap"| CheckoutReviewRoute
```

---

## Section A - Access And Auth Control Flow

```mermaid
flowchart TD
  Request[IncomingRequest]
  Middleware[Middleware]
  DevCookie{dev-authCookie}
  Holding[HoldingPage]
  PublicRoute{isPublicPath}
  SupabaseSession[SupabaseSessionCheck]
  SignIn[SignInPage]
  RouteAllowed[RouteAllowed]
  ApiRoute[ApiRoute]

  Request -->|"Current"| Middleware
  Middleware -->|"Current"| ApiRoute
  Middleware -->|"Current"| DevCookie
  DevCookie -->|"Current:NoAtRoot"| Holding
  DevCookie -->|"Current:NoNotRoot"| SignIn
  DevCookie -->|"Current:Yes"| SupabaseSession
  SupabaseSession -->|"Current:NoUserAndPublic"| RouteAllowed
  SupabaseSession -->|"Current:NoUserAndProtected"| SignIn
  SupabaseSession -->|"Current:UserPresent"| RouteAllowed

  RouteAllowed -->|"Current"| PublicAppFlow
  RouteAllowed -->|"Current"| AdminFlow
```

---

## Section B - Listing Lifecycle And Moderation

```mermaid
flowchart TD
  Seller[AuthenticatedSeller]
  Form[CreateListingForm]
  CreateAction[createListing]
  Draft[(ListingStatusDraft)]
  UploadImages[saveListingImages]
  PayAction[payForListing]
  Checkout{checkoutUrlReturned}
  RippleCheckout[RippleHostedCheckout]
  PaymentsWebhook[PaymentsWebhook]
  Pending[(ListingStatusPending)]
  ReviewAction[submitListingForReview]
  AdminReview[AdminModerationAction]
  Live[(ListingStatusLive)]
  Sold[(ListingStatusSold)]
  Expired[(ListingStatusExpired)]

  Seller -->|"Current"| Form
  Form -->|"Current"| CreateAction
  CreateAction -->|"Current"| Draft
  Form -->|"Current"| UploadImages
  UploadImages -->|"Current"| Draft
  Draft -->|"Current"| PayAction
  PayAction -->|"Current"| Checkout
  Checkout -->|"Current:Yes"| RippleCheckout
  RippleCheckout -->|"Current"| PaymentsWebhook
  PaymentsWebhook -->|"Current"| Pending
  Checkout -->|"Current:NoSkippedPayment"| ReviewAction
  ReviewAction -->|"Current"| Pending
  Pending -->|"Current"| AdminReview
  AdminReview -->|"Current:Approve"| Live
  AdminReview -->|"Current:RejectOrTakeDown"| Expired
  Live -->|"Current:OwnerMarksSold"| Sold

  RippleCheckout -->|"FutureGap:CancelRedirectPath"| SellCheckoutRoute
```

---

## Section C - Discovery, Engagement, And Trust Actions

```mermaid
flowchart TD
  User[VisitorOrBuyer]
  Home[HomePage]
  SearchControls[SearchControls]
  SearchApi[GETApiSearch]
  Listings[(ListingsData)]
  Detail[ListingDetailPage]
  Favourite[ToggleFavourite]
  SavedSearch[SaveSearch]
  Contact[ContactSeller]
  Report[ReportListing]
  Email[(EmailNotifications)]

  User -->|"Current"| Home
  Home -->|"Current"| SearchControls
  SearchControls -->|"Current"| SearchApi
  SearchApi -->|"Current"| Listings
  Listings -->|"Current"| Detail
  Detail -->|"Current"| Favourite
  Detail -->|"Current"| Contact
  Detail -->|"Current"| Report
  SearchControls -->|"Current"| SavedSearch
  Contact -->|"Current"| Email
  Report -->|"Current"| Email
```

---

## Section D - Payments And Webhook State Sync

```mermaid
flowchart TD
  Actor[SellerOrDealer]
  PaymentAction[paymentsAction]
  RippleSession[RippleHostedCheckout]
  PaymentsWebhook[POSTApiWebhooksPayments]
  PaymentRecord[(PaymentTable)]
  SubscriptionRecord[(SubscriptionTable)]
  ListingRecord[(ListingTable)]

  Actor -->|"Current"| PaymentAction
  PaymentAction -->|"Current:ListingPayment"| RippleSession
  PaymentAction -->|"Current:FeaturedUpgrade"| RippleSession
  PaymentAction -->|"Current:DealerSubscription"| RippleSession
  RippleSession -->|"Current"| PaymentsWebhook

  PaymentsWebhook -->|"Current:listing_payment"| PaymentRecord
  PaymentsWebhook -->|"Current:listing_payment"| ListingRecord
  PaymentsWebhook -->|"Current:featured_upgrade"| PaymentRecord
  PaymentsWebhook -->|"Current:featured_upgrade"| ListingRecord
  PaymentsWebhook -->|"Current:dealer_subscription"| SubscriptionRecord
  PaymentsWebhook -->|"Current:subscription_updated_deleted"| SubscriptionRecord
  PaymentsWebhook -->|"Current:payment_refunded"| PaymentRecord
```

---

## Section E - Prelaunch Waitlist And Admin Export

```mermaid
flowchart TD
  PublicUser[PublicVisitor]
  RootRequest[RequestSlash]
  Middleware[Middleware]
  Holding[HoldingPage]
  WaitlistForm[WaitlistForm]
  JoinWaitlist[joinWaitlistAction]
  WaitlistData[(WaitlistUserTable)]
  EmailSend[WaitlistEmails]
  AdminUser[AdminUser]
  ExportApi[GETApiAdminWaitlistExport]
  CsvDownload[CsvDownload]

  PublicUser -->|"Current"| RootRequest
  RootRequest -->|"Current"| Middleware
  Middleware -->|"Current:NoDevCookieRewrite"| Holding
  Holding -->|"Current"| WaitlistForm
  WaitlistForm -->|"Current"| JoinWaitlist
  JoinWaitlist -->|"Current"| WaitlistData
  JoinWaitlist -->|"Current"| EmailSend

  AdminUser -->|"Current"| ExportApi
  ExportApi -->|"Current"| WaitlistData
  ExportApi -->|"Current"| CsvDownload
```

---

## Future Gaps Register

- `FutureGap`: `SellCheckoutRoute` is referenced as a payment cancel destination in `actions/payments.ts` (`/sell/checkout?listing=...`) but no matching route exists under `app/(public)/sell`.
- `FutureGap`: move in-memory rate limiting (`lib/rate-limit.ts`) to shared/distributed storage for multi-instance reliability.
- `FutureGap`: add explicit user-facing 401/403 handling where `requireRole` throws in API routes to avoid generic 500 responses.
- `FutureGap`: replace temporary TLS bypass behavior in `instrumentation.ts` with production-safe certificate handling.

---

## Source Map (Implemented Flow Evidence)

- Access control: `middleware.ts`, `app/api/dev-auth/route.ts`
- Session/user identity: `app/api/me/route.ts`, `lib/auth/index.ts`, `components/layout/site-header.tsx`
- Discovery/search: `app/(public)/search/page.tsx`, `app/api/search/route.ts`, `components/marketplace/search/search-controls.tsx`
- Listing pipeline: `app/(public)/sell/create-listing-form.tsx`, `actions/listings.ts`, `actions/payments.ts`
- Payment reconciliation: `app/api/webhooks/payments/route.ts`
- Waitlist flow: `app/holding/page.tsx`, `components/waitlist/waitlist-form.tsx`, `actions/waitlist.ts`, `app/api/admin/waitlist/export/route.ts`
- Admin moderation/ops: `app/(admin)`, `actions/admin.ts`
