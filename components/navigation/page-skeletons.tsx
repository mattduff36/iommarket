import { Skeleton } from "@/components/ui/skeleton";

export type PageSkeletonKind = "cards" | "detail" | "table" | "form" | "page";

export function skeletonKind(path: string): PageSkeletonKind {
  if (/^\/admin(?:\/|$)/.test(path)) return "table";
  if (/^\/(listings|dealers)\/[^/]+/.test(path)) return "detail";
  if (/^\/(sign-in|sign-up|forgot-password|staging-access|sell|pay|sample-checkout)/.test(path)) return "form";
  if (/^\/(account|dealer)(?:\/|$)/.test(path)) return "table";
  if (path === "/" || /^\/(search|categories|dealers)/.test(path)) return "cards";
  return "page";
}

export function PageSkeleton({ kind = "page", label = "Loading page…" }: { kind?: PageSkeletonKind; label?: string }) {
  return (
    <section className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6" aria-busy="true" aria-label={label} data-page-skeleton={kind}>
      <p role="status" className="text-sm text-text-secondary">{label}</p>
      <div aria-hidden="true" className="space-y-6">
        <Skeleton className="h-8 w-2/5 max-w-sm motion-reduce:animate-none" />
        <Skeleton className="h-4 w-3/5 max-w-lg motion-reduce:animate-none" />
        {kind === "cards" ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="space-y-3"><Skeleton className="aspect-[4/3] motion-reduce:animate-none" /><Skeleton className="h-5 w-3/4 motion-reduce:animate-none" /><Skeleton className="h-4 w-1/2 motion-reduce:animate-none" /></div>)}
          </div>
        ) : kind === "detail" ? (
          <div className="grid gap-6 md:grid-cols-3"><Skeleton className="aspect-[4/3] md:col-span-2 motion-reduce:animate-none" /><Skeleton className="h-64 motion-reduce:animate-none" /></div>
        ) : (
          <div className={kind === "form" ? "max-w-xl space-y-5" : "space-y-4"}>
            {Array.from({ length: kind === "table" ? 7 : 4 }, (_, i) => <Skeleton key={i} className={`${kind === "page" ? "h-16" : "h-12"} w-full motion-reduce:animate-none`} />)}
          </div>
        )}
      </div>
    </section>
  );
}
