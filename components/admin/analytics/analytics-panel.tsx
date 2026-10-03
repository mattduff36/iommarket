import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function AnalyticsPanel({
  id,
  title,
  detail,
  children,
  className,
}: {
  id: string;
  title: string;
  detail?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-lg border border-border bg-surface p-4 shadow-low sm:p-5", className)}
    >
      <h2 id={id} className="text-sm font-semibold text-text-primary">
        {title}
        {detail ? <span className="ml-2 font-normal text-text-tertiary">{detail}</span> : null}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
