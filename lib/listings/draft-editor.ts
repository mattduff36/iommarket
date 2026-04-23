interface DraftEditorHrefInput {
  listingId: string;
  dealerId: string | null;
}

export function getDraftEditorHref({ listingId, dealerId }: DraftEditorHrefInput) {
  const params = new URLSearchParams({ draft: listingId });
  const basePath = dealerId ? "/sell/dealer" : "/sell/private";

  return `${basePath}?${params.toString()}`;
}
