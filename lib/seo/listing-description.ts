function completeSentences(text: string | null | undefined, maxLength: number): string {
  const clean = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let combined = "";
  for (const sentence of sentences) {
    const next = combined ? `${combined} ${sentence}` : sentence;
    if (next.length > maxLength) break;
    combined = next;
  }
  return combined;
}

export function buildListingShareDescription(input: {
  title: string;
  priceLabel?: string | null;
  location?: string | null;
  year?: string | null;
  status?: string | null;
  description?: string | null;
}): string {
  const title = input.title.replace(/\s+/g, " ").trim();
  const year = input.year?.trim();
  const titled = year && !title.startsWith(year) ? `${year} ${title}` : title;
  const location = input.location?.replace(/\s+/g, " ").trim();
  const price = input.priceLabel?.replace(/\s+/g, " ").trim();
  const details = [
    titled,
    location ? `located in ${location}` : "",
    price ? `advertised at ${price}` : "",
  ].filter(Boolean);
  const facts = `${details.join(", ")}.`;
  const sold = input.status === "SOLD" ? "This vehicle has been sold." : "";
  const composed = sold ? `${sold} ${facts}` : facts;
  if (composed.length <= 200) return composed;
  const fromDescription = completeSentences(input.description, 180);
  return fromDescription || facts;
}
