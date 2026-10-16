# Responsive tables — staging, 16 October 2026

## Scope and approach

The shared Table enforced 640px, AdminTable enforced 720/900px, and preview
packs enforced 920px. These minimums caused scrolling on phones and beside
the desktop sidebar. All shared admin/account tables now fit their container.
Below 760px of available content width, rows become labelled records; sortable
headers remain available above them. Native table roles, links, forms, menus,
column visibility, pagination and server data/authentication remain intact.

Users combines access, region and dealer information into Account details.
Dealers combines verification and plan/access into Status & access. Separate
region/dealer/verification columns remain optional for sorting/comparison;
Updated is optional rather than shown by default. Saved column choices remain
respected. Nothing is removed from the underlying records or detail pages.

## Coverage

- Shared admin tables: Users, Dealers, Listings, Payments/subscriptions and
  unmatched payments, Cancellations, Waitlist, Categories, Regions, Pages,
  Preview packs, Dealer onboarding, Revenue, Costs and analytics rankings.
- Shared account tables: personal listings, dealer listings and subscriptions.
- Nested admin tables: user details and monitoring details.
- Native tables: database inspection counts and cost source audit now use the
  same responsive frame.
- The UI demo inherits the shared component. Vehicle-check print tables are
  deliberately unchanged because they target printed documents.

Labels are derived from the rendered headers, including server-rendered
sortable components, and refreshed when pagination replaces rows. Full-width
empty/detail cells do not get misleading labels. Complex spanning headers
retain normal table layout. Without JavaScript, ordinary table scrolling is
available as progressive fallback rather than hiding data.

## Constraints

No background gradients, authentication, database, payment or production
changes. Release is to staging only, followed by owner review before any
staging-to-main merge.
