export interface RevisionPreviewSide {
  title: string;
  description: string;
  price: number;
  categoryName: string;
  regionName: string;
  attributes: Array<{ name: string; value: string }>;
  imagePublicIds: string[];
}

export interface RevisionFieldDiff {
  field: string;
  live: string;
  proposed: string;
}

function formatPricePence(price: number) {
  return `£${(price / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function attributeMap(attributes: RevisionPreviewSide["attributes"]) {
  return new Map(attributes.map((attribute) => [attribute.name, attribute.value]));
}

export function buildRevisionFieldDiffs(
  live: RevisionPreviewSide,
  proposed: RevisionPreviewSide,
): RevisionFieldDiff[] {
  const diffs: RevisionFieldDiff[] = [];
  const scalarFields: Array<[string, string, string]> = [
    ["Title", live.title, proposed.title],
    ["Description", live.description, proposed.description],
    ["Price", formatPricePence(live.price), formatPricePence(proposed.price)],
    ["Category", live.categoryName, proposed.categoryName],
    ["Region", live.regionName, proposed.regionName],
  ];
  for (const [field, liveValue, proposedValue] of scalarFields) {
    if (liveValue !== proposedValue) {
      diffs.push({ field, live: liveValue, proposed: proposedValue });
    }
  }

  const liveAttributes = attributeMap(live.attributes);
  const proposedAttributes = attributeMap(proposed.attributes);
  const names = new Set([...liveAttributes.keys(), ...proposedAttributes.keys()]);
  for (const name of names) {
    const liveValue = liveAttributes.get(name) ?? "";
    const proposedValue = proposedAttributes.get(name) ?? "";
    if (liveValue !== proposedValue) {
      diffs.push({ field: name, live: liveValue || "-", proposed: proposedValue || "-" });
    }
  }

  const livePhotos = new Set(live.imagePublicIds);
  const proposedPhotos = new Set(proposed.imagePublicIds);
  const added = proposed.imagePublicIds.filter((id) => !livePhotos.has(id));
  const removed = live.imagePublicIds.filter((id) => !proposedPhotos.has(id));
  if (added.length > 0 || removed.length > 0) {
    diffs.push({
      field: "Photos",
      live: removed.length > 0 ? `Removed: ${removed.join(", ")}` : "No removals",
      proposed: added.length > 0 ? `Added: ${added.join(", ")}` : "No additions",
    });
  }

  return diffs;
}

export function revisionPhotosChanged(
  live: Pick<RevisionPreviewSide, "imagePublicIds">,
  proposed: Pick<RevisionPreviewSide, "imagePublicIds">,
) {
  return live.imagePublicIds.join("\0") !== proposed.imagePublicIds.join("\0");
}
