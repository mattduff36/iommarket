export function listingReviewHref(listingId: string) {
  return `/listings/${encodeURIComponent(listingId)}?adminReview=1`;
}

export function dealerAdminHref(dealerId: string) {
  return `/admin/dealers?id=${encodeURIComponent(dealerId)}`;
}

export function userAdminHref(userId: string) {
  return `/admin/users/${encodeURIComponent(userId)}`;
}

const AUDIT_RECORD_HREFS: Record<string, (id: string) => string> = {
  User: userAdminHref,
  Listing: listingReviewHref,
  DealerProfile: dealerAdminHref,
  MonitoringIssue: (id) => `/admin/monitoring/${encodeURIComponent(id)}`,
  ContentPage: (id) => `/admin/pages/${encodeURIComponent(id)}`,
  InvoiceRequest: (id) => `/admin/costs/confirm/${encodeURIComponent(id)}`,
};

export function auditRecordHref(entityType: string, entityId: string) {
  const href = AUDIT_RECORD_HREFS[entityType];
  if (!href || !entityId) return null;
  return href(entityId);
}
