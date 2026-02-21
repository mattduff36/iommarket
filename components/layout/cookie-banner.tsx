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
    <div className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-border bg-surface p-4 shadow-high">
      <p className="text-sm text-text-secondary">
        We use essential cookies to keep the marketplace secure and functional.
        Read our{" "}
        <Link href="/cookies" className="text-text-trust hover:underline">
          cookie policy
        </Link>
        .
      </p>
      <div className="mt-3">
        <Button type="button" size="sm" onClick={accept}>
          Accept
        </Button>
      </div>
    </div>
  );
}
