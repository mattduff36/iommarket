import { WRITE_OFF_CATEGORY_SLUG } from "@/lib/listings/write-off-category";

export function groupWriteOffWithVehicleDetails<T extends { slug: string }>(
  attributes: T[],
): T[] {
  const writeOffIndex = attributes.findIndex(
    (attribute) => attribute.slug === WRITE_OFF_CATEGORY_SLUG,
  );
  if (writeOffIndex === -1) {
    return attributes;
  }

  const writeOff = attributes[writeOffIndex];
  const withoutWriteOff = attributes.filter(
    (_, index) => index !== writeOffIndex,
  );
  let insertAfter = -1;
  for (let index = 0; index < withoutWriteOff.length; index += 1) {
    const slug = withoutWriteOff[index].slug;
    if (slug === "mileage" || slug === "fuel-type") {
      insertAfter = index;
    }
  }

  if (insertAfter === -1) {
    return attributes;
  }

  return [
    ...withoutWriteOff.slice(0, insertAfter + 1),
    writeOff,
    ...withoutWriteOff.slice(insertAfter + 1),
  ];
}
