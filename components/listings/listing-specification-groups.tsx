import { groupPublicSpecifications } from "@/lib/listings/vehicle-detail-catalog";

export function ListingSpecificationGroups({
  categorySlug,
  attributes,
}: {
  categorySlug: string;
  attributes: Array<{
    slug: string;
    name: string;
    value: string;
    sortOrder: number;
  }>;
}) {
  const groups = groupPublicSpecifications({ categorySlug, attributes });
  if (groups.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="section-heading-accent mb-5 text-lg font-bold text-text-primary">
        Specifications
      </h2>
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.id} className="min-w-0">
            {group.title ? (
              <h3 className="mb-3 text-sm font-semibold text-text-primary">{group.title}</h3>
            ) : null}
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {group.items.map((attribute) => (
                <div key={attribute.slug} className="flex min-w-0 flex-col">
                  <dt className="font-medium text-text-secondary">{attribute.name}</dt>
                  <dd className="break-words text-text-primary">{attribute.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
