export interface WaitlistSnapshotRow {
  id: string;
  email: string;
  interests: unknown;
  source: string;
  deletedAt: string | null;
  deletedByAdminId: string | null;
  deletionReason: string | null;
  marketingConsentAt: string | null;
  marketingPolicyVersion: string | null;
  marketingWithdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WaitlistMergePlan {
  inserts: WaitlistSnapshotRow[];
  updates: Array<{ previewId: string; row: WaitlistSnapshotRow }>;
  result: WaitlistSnapshotRow[];
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function payload(row: WaitlistSnapshotRow) {
  return {
    email: row.email,
    interests: row.interests,
    source: row.source,
    deletedAt: row.deletedAt,
    deletedByAdminId: row.deletedByAdminId,
    deletionReason: row.deletionReason,
    marketingConsentAt: row.marketingConsentAt,
    marketingPolicyVersion: row.marketingPolicyVersion,
    marketingWithdrawnAt: row.marketingWithdrawnAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function samePayload(left: WaitlistSnapshotRow, right: WaitlistSnapshotRow) {
  return JSON.stringify(payload(left)) === JSON.stringify(payload(right));
}

function withPreviewId(previewId: string, production: WaitlistSnapshotRow): WaitlistSnapshotRow {
  return { ...production, id: previewId };
}

export function mergeWaitlistRows(
  preview: WaitlistSnapshotRow[],
  production: WaitlistSnapshotRow[],
): WaitlistMergePlan {
  const previewByEmail = new Map(preview.map((row) => [normalizeEmail(row.email), row]));
  const previewIds = new Set(preview.map((row) => row.id));
  const inserts: WaitlistSnapshotRow[] = [];
  const updates: Array<{ previewId: string; row: WaitlistSnapshotRow }> = [];
  const resultByEmail = new Map(previewByEmail);

  for (const productionRow of production) {
    const email = normalizeEmail(productionRow.email);
    const existing = previewByEmail.get(email);
    if (!existing) {
      const insertRow =
        previewIds.has(productionRow.id)
          ? { ...productionRow, id: `waitlist-copy:${productionRow.id}` }
          : productionRow;
      inserts.push(insertRow);
      previewIds.add(insertRow.id);
      resultByEmail.set(email, insertRow);
      continue;
    }
    const merged = withPreviewId(existing.id, productionRow);
    if (!samePayload(existing, merged)) {
      updates.push({ previewId: existing.id, row: merged });
    }
    resultByEmail.set(email, merged);
  }

  return {
    inserts,
    updates,
    result: [...resultByEmail.values()].sort((left, right) =>
      normalizeEmail(left.email).localeCompare(normalizeEmail(right.email)),
    ),
  };
}

export function waitlistEmailSet(rows: WaitlistSnapshotRow[]) {
  return new Set(rows.map((row) => normalizeEmail(row.email)));
}

export function assertProductionWaitlistCopied(
  production: WaitlistSnapshotRow[],
  destination: WaitlistSnapshotRow[],
) {
  const dest = new Map(destination.map((row) => [normalizeEmail(row.email), row]));
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const row of production) {
    const copied = dest.get(normalizeEmail(row.email));
    if (!copied) {
      missing.push(row.email);
      continue;
    }
    if (!samePayload(copied, { ...row, id: copied.id })) {
      mismatched.push(row.email);
    }
  }
  if (missing.length > 0 || mismatched.length > 0) {
    throw new Error(
      `Waitlist copy incomplete: missing=${missing.join(",") || "(none)"} mismatched=${mismatched.join(",") || "(none)"}`,
    );
  }
}
