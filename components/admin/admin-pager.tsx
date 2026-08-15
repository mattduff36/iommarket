import Link from "next/link";

export function AdminPager({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (nextPage: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-4 flex gap-2 text-sm">
      {page > 1 ? <Link href={hrefForPage(page - 1)}>Previous</Link> : null}
      <span>
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? <Link href={hrefForPage(page + 1)}>Next</Link> : null}
    </div>
  );
}
