export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { ConfirmCorrespondenceForm } from "./confirm-correspondence-form";

export const metadata: Metadata = {
  title: "Confirm correspondence email",
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function ConfirmCorrespondencePage({ searchParams }: Props) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-text-primary">Confirm correspondence email</h1>
      {token.length < 32 ? (
        <p className="mt-4 text-sm text-text-secondary">
          This confirmation link is not valid. Open the confirmation email from iTrader and use the button in that message.
        </p>
      ) : (
        <div className="mt-6">
          <ConfirmCorrespondenceForm token={token} />
        </div>
      )}
    </div>
  );
}
