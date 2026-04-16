"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "iommarket-cookie-consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const value = window.localStorage.getItem(STORAGE_KEY);
    setVisible(value !== "accepted");
  }, []);

  function accept() {
    window.localStorage.setItem(STORAGE_KEY, "accepted");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed left-1/2 z-50 w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 rounded-xl border border-border bg-surface px-4 py-3 shadow-high sm:w-auto sm:rounded-full sm:px-5 sm:py-2.5"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <p className="text-xs leading-relaxed text-text-secondary sm:text-sm">
          We use essential cookies to keep the marketplace secure and functional.
          Read our{" "}
          <Link href="/cookies" className="text-text-trust hover:underline">
            cookie policy
          </Link>
          .
        </p>
        <Button
          type="button"
          size="sm"
          onClick={accept}
          className="w-full sm:w-auto"
        >
          Accept
        </Button>
      </div>
    </div>
  );
}
