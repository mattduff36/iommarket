"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  email: string;
}

export function CopyEmailButton({ email }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
