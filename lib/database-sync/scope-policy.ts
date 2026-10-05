export const DATABASE_SYNC_SCOPE = "marketplace-exclusions-v1";
export const EXCLUDED_SYNC_TABLES = [
  "DealerPreviewPack", "WaitlistUser", "WaitlistEarlyAccessCampaign", "WaitlistEarlyAccessRecipient",
  "MonitoringIssue", "MonitoringIssueStatusEvent", "MonitoringEvent", "MonitoringAlertDelivery", "MonitoringPipelineHealth",
  "DealerPromotionCampaign", "DealerOnboardingInvite", "DealerOnboardingInviteEvent",
] as const;

export function excludedSyncTable(name: string): boolean {
  return /^(?:DealerPreviewPack|Waitlist|Monitoring|DealerPromotionCampaign|DealerOnboardingInvite)/.test(name);
}

export const SYNC_SCOPE_DESCRIPTION = "Preview packs and their linked accounts/listings, waitlists, monitoring, promotional campaigns and linked records are excluded. Administrator accounts are never imported or overwritten. Existing staging versions remain unchanged.";
export const SCOPED_MERGE_ONLY = "Only scoped Merge is available. Full-database Replace, Reset and Restore are disabled because they could change excluded staging data. Encrypted backups are retained.";

export type ScopeRow = { id: string; values: Record<string, string | null> };
export type ScopeForeignKey = { child: string; parent: string; childColumns: string[]; parentColumns: string[] };
export type ScopeExclusions = Record<string, string[]>;

/** Follow actual composite foreign keys. Never detach or relink a skipped parent's children. */
export function expandScopeExclusions(rows: Record<string, ScopeRow[]>, keys: readonly ScopeForeignKey[], roots: ScopeExclusions): ScopeExclusions {
  const omitted = new Map(Object.entries(roots).map(([table, ids]) => [table, new Set(ids)]));
  const tuple = (row: ScopeRow, columns: string[]) => {
    const values = columns.map((column) => row.values[column]);
    return values.every((value) => value != null) ? JSON.stringify(values) : null;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of keys) {
      if (!rows[key.child]) continue;
      const allParents = excludedSyncTable(key.parent);
      const excludedParents = omitted.get(key.parent);
      if (!allParents && !excludedParents?.size) continue;
      const parentValues = new Set((rows[key.parent] ?? []).filter((row) => excludedParents?.has(row.id)).map((row) => tuple(row, key.parentColumns)).filter((value) => value !== null));
      const children = omitted.get(key.child) ?? new Set<string>();
      for (const row of rows[key.child]) {
        const value = tuple(row, key.childColumns);
        if (value !== null && (allParents || parentValues.has(value)) && !children.has(row.id)) {
          children.add(row.id);
          changed = true;
        }
      }
      omitted.set(key.child, children);
    }
  }
  return Object.fromEntries([...omitted].map(([table, ids]) => [table, [...ids].sort()]));
}

/** Explicit owner-approved exclusions, independent of current account roles. */
export const EXCLUDED_SYNC_USER_IDS: readonly string[] = [
  "cmusfwkh5000006pjpp1gnslj", "cmus3bgau000004jjx43oid1l",
];

export function scopeRowExcluded(table: string, id: string, excluded: ScopeExclusions): boolean {
  return excludedSyncTable(table) || Boolean(excluded[table]?.includes(id));
}
