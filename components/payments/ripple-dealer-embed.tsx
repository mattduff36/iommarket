"use client";

import Script from "next/script";
import { getRippleDealerEmbedScriptUrl } from "@/lib/payments/ripple-dealer-embed";

export function RippleDealerEmbed() {
  const scriptUrl = getRippleDealerEmbedScriptUrl();
  return (
    <div
      className="ripple-dealer-embed space-y-3"
      data-ripple-embed-src={scriptUrl}
    >
      <p className="text-sm text-text-secondary">
        Complete dealer signup on this page. Ripple then sends you to Cashflows
        to collect the card. Subscription access still comes from the Ripple
        webhook, not from this form submitting.
      </p>
      <div data-ripple-signup="" />
      <Script src={scriptUrl} strategy="afterInteractive" />
    </div>
  );
}
