import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold text-text-primary">IOM Market</h1>
      <p className="text-text-secondary">
        Marketplace UI library is ready.
      </p>
      <Link
        href="/styleguide"
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-text hover:bg-primary-hover transition-colors focus:shadow-outline focus:outline-none"
      >
        View Styleguide
      </Link>
    </main>
  );
}
