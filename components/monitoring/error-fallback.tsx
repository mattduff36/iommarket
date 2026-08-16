import Link from "next/link";

interface Props {
  title: string;
  onRetry?: () => void;
}

export function MonitoringErrorFallback({ title, onRetry }: Props) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
      <p className="text-sm text-text-secondary">
        An unexpected error occurred. You can retry this page or return home.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-primary"
          >
            Try again
          </button>
        ) : null}
        <Link
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
