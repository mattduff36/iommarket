# DVLA + MOT API Reuse Guide

Use this guide as the implementation brief for another project. It matches the working pattern in this repo, especially:

- `lib/services/dvla-api.ts`
- `lib/services/mot-history-api.ts`
- `lib/services/fleet-dvla-sync.ts`
- `app/api/maintenance/sync-dvla/route.ts`
- `app/(dashboard)/maintenance/components/DVLASyncButton.tsx`

Implement the integration as a server-only feature. Do not call DVLA or MOT APIs directly from the browser.

## 1. Environment Variables

Use the same env var names as this project:

```bash
DVLA_API_PROVIDER=
DVLA_API_KEY=
DVLA_API_BASE_URL=

MOT_API_CLIENT_ID=
MOT_API_CLIENT_SECRET=
MOT_API_SCOPE=
MOT_API_ACCESS_TOKEN_URL=
MOT_API_KEY=
MOT_API_BASE_URL=
```

Notes:

- `MOT_API_BASE_URL` can default to `https://history.mot.api.gov.uk`
- Keep the actual values the same as the current project if you want identical behavior
- The services in this project read `process.env` directly

## 2. Overall Architecture

Create 3 layers:

1. `DVLA service`
   - fetches tax status, tax due date, make, colour, fuel type, and other DVLA/VES fields
2. `MOT service`
   - gets OAuth token
   - fetches MOT history
   - extracts the current MOT expiry date / status
3. `Internal sync route or server action`
   - authenticates the user if needed
   - normalizes the registration
   - calls DVLA first
   - calls MOT second if configured
   - combines the result
   - persists/logs it if your app has a database
   - returns a clean JSON response to the UI

## 3. Registration Number Normalization

Before every external API call:

- remove all spaces
- trim
- uppercase

Use this exact rule:

```ts
function formatRegistrationForApi(reg: string): string {
  return reg.replace(/\s+/g, '').trim().toUpperCase();
}
```

Examples:

- `BC21 YZU` -> `BC21YZU`
- ` bc21  yzu ` -> `BC21YZU`

## 4. DVLA Service

Create a server-side service with a factory function:

```ts
const dvlaService = createDVLAApiService();
if (!dvlaService) {
  // treat as feature disabled / misconfigured
}
```

Factory behavior:

- read `DVLA_API_PROVIDER`, `DVLA_API_KEY`, `DVLA_API_BASE_URL`
- if any are missing, return `null`

Main method:

- `getVehicleData(registrationNumber: string)`

For official VES provider:

- `POST ${DVLA_API_BASE_URL}/vehicles`
- headers:
  - `x-api-key: <DVLA_API_KEY>`
  - `Content-Type: application/json`
- body:

```json
{
  "registrationNumber": "BC21YZU"
}
```

Expected normalized output shape:

- `registrationNumber`
- `taxStatus`
- `taxDueDate`
- `motStatus`
- `motExpiryDate`
- `make`
- `model`
- `colour`
- `yearOfManufacture`
- `engineSize`
- `fuelType`
- `co2Emissions`
- `rawData`

Important:

- the current repo supports multiple providers, but the service always normalizes them into one common response shape

## 5. MOT Service

Create a server-side MOT service with a factory:

```ts
const motService = createMotHistoryService();
```

Factory behavior:

- read:
  - `MOT_API_CLIENT_ID`
  - `MOT_API_CLIENT_SECRET`
  - `MOT_API_SCOPE`
  - `MOT_API_ACCESS_TOKEN_URL`
  - `MOT_API_KEY`
- if any are missing, return `null`

### OAuth Token Flow

Request token with `client_credentials`:

- `POST ${MOT_API_ACCESS_TOKEN_URL}`
- header:
  - `Content-Type: application/x-www-form-urlencoded`
- body:
  - `grant_type=client_credentials`
  - `client_id=<MOT_API_CLIENT_ID>`
  - `client_secret=<MOT_API_CLIENT_SECRET>`
  - `scope=<MOT_API_SCOPE>`

Cache the token in memory. This project caches it until close to expiry and refreshes with a 5-minute safety buffer.

### MOT History Request

Use the current working endpoint:

- `GET ${MOT_API_BASE_URL || "https://history.mot.api.gov.uk"}/v1/trade/vehicles/registration/${REG}`

Headers:

- `Authorization: Bearer <access_token>`
- `X-API-Key: <MOT_API_KEY>`

Do not add extra headers unless needed. This repo intentionally uses minimal headers.

### MOT Response Handling

Primary methods:

- `getMotHistory(registration)`
- `getMotExpiryData(registration)`

`getMotExpiryData()` should:

- sort tests newest first
- find the latest passed test
- treat these as pass results:
  - `PASSED`
  - `PASS`
  - `PRS`

Why `PRS` matters:

- this repo supports HGV/annual-test style results, not just normal MOT wording

Return:

- `registration`
- `motExpiryDate`
- `motStatus`
- `lastTestDate`
- `lastTestResult`
- `rawData`

## 6. Combine DVLA + MOT In One Sync Flow

This repo's actual pattern is:

1. normalize registration
2. call DVLA
3. call MOT if configured
4. if MOT succeeds, prefer MOT expiry data for `mot_due_date`
5. if MOT fails because there is no history yet, fall back to calculation from first registration date
6. persist the raw responses and sync status

Use this exact preference order:

### Tax Due Date

- use `dvlaData.taxDueDate`

### MOT Due Date

- use `motExpiryData.motExpiryDate` if available
- otherwise, if MOT says the vehicle is too new and DVLA has first registration month, calculate it
- otherwise leave blank or log as unavailable

### Fallback MOT Calculation

If MOT has no history and DVLA provides `monthOfFirstRegistration`:

- for vans/cars: first MOT due = first registration date + 3 years
- for HGVs: first annual test due = first registration date + 1 year

This is important because newer vehicles may have:

- no MOT tests yet
- but still a predictable first due date

## 7. Internal Route Contract

Create an internal API route like:

- `POST /api/maintenance/sync-dvla`

Accepted body in this repo:

```json
{
  "assetId": "uuid",
  "assetType": "van"
}
```

It also supports:

- `vehicleId`
- `vehicleIds`
- `assetIds`
- `syncAll`

Response shape:

```json
{
  "success": true,
  "total": 1,
  "successful": 1,
  "failed": 0,
  "results": [
    {
      "success": true,
      "assetType": "van",
      "assetId": "uuid",
      "vehicleId": "uuid",
      "registrationNumber": "BC21 YZU",
      "updatedFields": ["tax_due_date", "mot_due_date"],
      "syncedAt": "2026-04-08T12:34:56.000Z"
    }
  ]
}
```

If DVLA is not configured, return `503`.

In this repo the error message is effectively:

- DVLA API not configured
- please configure provider, key, and base URL

## 8. Frontend Usage

The browser should only call your internal route.

Example:

```ts
const response = await fetch('/api/maintenance/sync-dvla', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    assetId: vehicleId,
    assetType: 'van',
  }),
});

const data = await response.json();
```

UI behavior used here:

- show loading state while syncing
- on success, show which fields changed
- on no changes, show "data is up to date"
- on `503`, show "API not configured"
- on failure, surface the returned error message

## 9. Minimal Server-Side Implementation Pattern

```ts
const dvlaService = createDVLAApiService();
if (!dvlaService) {
  throw new Error('DVLA API not configured');
}

const motService = createMotHistoryService(); // optional
const reg = formatRegistrationForApi(asset.reg_number);

const dvlaData = await dvlaService.getVehicleData(reg);

let motData = null;
let motError: string | null = null;

if (motService) {
  try {
    motData = await motService.getMotExpiryData(reg);
  } catch (error) {
    motError = error instanceof Error ? error.message : String(error);
  }
}

const result = {
  registrationNumber: asset.reg_number,
  taxDueDate: dvlaData.taxDueDate ?? null,
  motDueDate: motData?.motExpiryDate ?? null,
  dvlaRawData: dvlaData.rawData ?? null,
  motRawData: motData?.rawData ?? null,
  motStatus: motData?.motStatus ?? dvlaData.motStatus ?? null,
  motError,
};
```

## 10. Database Fields To Persist

Recommended persisted fields from this repo's pattern:

- `tax_due_date`
- `mot_due_date`
- `mot_expiry_date`
- `last_dvla_sync`
- `dvla_sync_status`
- `dvla_sync_error`
- `dvla_raw_data`
- `last_mot_api_sync`
- `mot_api_sync_status`
- `mot_api_sync_error`
- `mot_raw_data`

Useful DVLA fields:

- `ves_make`
- `ves_colour`
- `ves_fuel_type`
- `ves_year_of_manufacture`
- `ves_engine_capacity`
- `ves_tax_status`
- `ves_mot_status`
- `ves_month_of_first_registration`

Useful MOT fields:

- `mot_make`
- `mot_model`
- `mot_fuel_type`
- `mot_primary_colour`
- `mot_registration`
- `mot_first_used_date`

## 11. Error Handling Rules

Handle these cases explicitly:

- `404` from MOT API:
  - treat as "No MOT history found"
  - this does not always mean invalid vehicle
  - it can also mean a newer vehicle has not needed its first MOT yet
- `429` from MOT API:
  - treat as rate limit exceeded
  - do not spam retries
- invalid registration:
  - bubble the error up to your internal route
  - return a clear message to the UI
- missing env vars:
  - disable the feature cleanly
  - do not crash the whole app at import time

## 12. Important Project-Specific Behavior Copied From This Repo

- test registrations are excluded from road sync logic
- MOT is optional, DVLA is required
- MOT data is preferred over DVLA for actual MOT expiry date
- HGV pass codes include `PRS`
- all external calls use server-side `fetch`
- both services use a 15-second timeout
- auth/API secrets never go to the client

## 13. What To Build In The New Project

At minimum, create these files/modules:

- `lib/services/dvla-api.ts`
- `lib/services/mot-history-api.ts`
- `lib/utils/registration.ts`
- one internal route or server action that combines both services
- one client button or action that calls only the internal route

If you have a database, also add:

- sync status fields
- raw response storage
- audit log table
