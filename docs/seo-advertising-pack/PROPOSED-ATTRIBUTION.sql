-- PROPOSED ONLY. Do not apply to preview or production without a separate approval.
-- Target: the shared application database, after a backup.
-- Effect: stores consented campaign attribution against an opaque outcome id.
-- The running application does not read or write this table.

create table if not exists "AdvertisingAttribution" (
  "id" text primary key,
  "outcomeType" text not null,
  "outcomeId" text not null,
  "consentVersion" text not null,
  "firstTouch" jsonb not null,
  "lastTouch" jsonb not null,
  "capturedAt" timestamptz not null,
  "expiresAt" timestamptz not null
);

create unique index if not exists "AdvertisingAttribution_outcome"
  on "AdvertisingAttribution" ("outcomeType", "outcomeId");
create index if not exists "AdvertisingAttribution_expiresAt"
  on "AdvertisingAttribution" ("expiresAt");
