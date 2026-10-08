import Link from "next/link";

interface Props {
  title: string;
  onRetry?: () => void;
  supportReference?: string | null;
  explanation?: string;
}

export function MonitoringErrorFallback({
  title,
  onRetry,
  supportReference,
  explanation = "This page didn't finish loading. You can try again or return home.",
}: Props) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
      <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
      <p className="text-sm text-text-secondary">{explanation}</p>
      {supportReference ? (
        <p className="text-sm text-text-secondary">
          If it continues, contact support with reference {supportReference}.
        </p>
      ) : null}
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
        <a href="mailto:hello@itrader.im" className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
          Contact support
        </a>
      </div>
    </div>
  );
}
