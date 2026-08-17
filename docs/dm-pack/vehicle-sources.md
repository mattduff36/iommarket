# Vehicle Check source register

This register describes the sources currently used by the Vehicle Check implementation. It is operational source documentation, not legal approval or a warranty of source availability.

## DVLA vehicle enquiry

- Purpose: UK tax status and base vehicle details.
- Implementation: `lib/services/dvla-api.ts`.
- Configuration: server-side provider URL and API credential.
- Limitations: provider availability, source latency, registration matching, and incomplete fields.

## DVSA MOT history

- Purpose: MOT status, test history, defects, and recorded mileage.
- Implementation: `lib/services/mot-history.ts`.
- Configuration: server-side MOT history provider.
- Limitations: unavailable or delayed test records, changed registrations, and records that cannot be linked to a Manx registration.

## Isle of Man Government vehicle search

- Source: `https://services.gov.im/service/VehicleSearch`
- Purpose: current Manx vehicle and duty information, including a previous UK registration where returned.
- Implementation: `lib/services/iom-vehicle-api.ts`.
- Limitations: public-service availability, HTML or response-format changes, and incomplete previous-registration links.

## Auction references

- Source: `https://www.easyliveauction.com`
- Current source label: Chrystals Auctions via Easy Live Auction.
- Purpose: possible external auction-lot references.
- Implementation: `lib/services/auction-history-api.ts`.
- Limitations: a text or registration match is not proof of vehicle identity; source pages can change or disappear.

## Aggregation and disclosure

- Aggregation: `lib/services/vehicle-check-aggregator.ts`.
- Public API boundary: `app/api/vehicle-check/route.ts`.
- Browser acknowledgement: version and acknowledgement time only; no registration or result data is stored with it.
- User-facing terms: `content/policies/vehicle-check-terms.md`.
