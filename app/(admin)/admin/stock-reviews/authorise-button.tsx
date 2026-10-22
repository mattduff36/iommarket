"use client";

import { useFormStatus } from "react-dom";

export function AuthoriseStockComputerButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-busy={pending}
    data-stock-review-editing={pending ? "true" : undefined}
    className="rounded-md bg-neon-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
    <span role="status">{pending ? "Authorising computer…" : "Authorise this computer"}</span>
  </button>;
}
