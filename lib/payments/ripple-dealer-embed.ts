export const RIPPLE_DEALER_EMBED_CLIENT_ID = "codelabplatfdcf3a8";
export const RIPPLE_DEALER_EMBED_SLUG = "-dealer-subscription";

export function getRippleDealerEmbedScriptUrl(
  clientId = RIPPLE_DEALER_EMBED_CLIENT_ID,
  slug = RIPPLE_DEALER_EMBED_SLUG,
) {
  return `https://portal.startyourripple.co.uk/card/${clientId}/embed-signup/${slug}`;
}
