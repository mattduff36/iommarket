"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import {
  cancelSamplePayment,
  submitSamplePayment,
} from "@/actions/sample-payments";
import { useCheckoutWindowHandoff } from "@/components/payments/checkout-window-handoff";
import {
  createPaymentReturnEvent,
  publishCheckoutHandoff,
  type PaymentReturnContext,
  type PaymentReturnEvent,
} from "@/lib/payments/checkout-handoff";
import type { SampleCheckoutKind, SampleCheckoutView } from "@/lib/payments/sample-checkout";

type CardChoice = "approve" | "decline";

function sampleReturnContext(kind: SampleCheckoutKind): PaymentReturnContext {
  if (kind === "featured_upgrade") return "featured";
  if (kind === "dealer_subscription") return "subscription";
  return "listing";
}

function formatAmount(amountPence: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}

export function SampleCheckout({
  checkout: initialCheckout,
}: {
  checkout: SampleCheckoutView;
}) {
  const [checkout, setCheckout] = useState(initialCheckout);
  const [selectedCard, setSelectedCard] = useState<CardChoice | null>(null);
  const [message, setMessage] = useState("");
  const [retrying, setRetrying] = useState(initialCheckout.status !== "FAILED");
  const [isExpired, setIsExpired] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [handoffEvent, setHandoffEvent] = useState<PaymentReturnEvent | null>(null);
  const showReturnFallback = useCheckoutWindowHandoff(handoffEvent);
  const isTerminal = checkout.status === "SUCCEEDED" || checkout.status === "CANCELLED";
  const attemptsLeft = Math.max(0, 3 - checkout.attemptCount);
  const formattedAmount = formatAmount(checkout.amountPence, checkout.currency);

  useEffect(() => {
    let timer: number;
    const checkExpiry = () => {
      const delay = Date.parse(checkout.expiresAt) - Date.now();
      if (delay <= 0) {
        setIsExpired(true);
        return;
      }
      timer = window.setTimeout(checkExpiry, Math.min(delay, 2_147_000_000));
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [checkout.expiresAt]);

  function notifyMarketplace(nextStatus: SampleCheckoutView["status"]) {
    if (nextStatus === "SUCCEEDED") {
      setHandoffEvent(createPaymentReturnEvent({
        status: "success",
        context: sampleReturnContext(checkout.kind),
        sampleCheckoutId: checkout.id,
      }));
      return;
    }
    publishCheckoutHandoff(createPaymentReturnEvent({
      status: nextStatus === "FAILED" ? "failed" : "cancel",
      context: sampleReturnContext(checkout.kind),
      sampleCheckoutId: checkout.id,
    }));
  }

  function submitPayment() {
    if (!selectedCard || isPending || checkout.status === "SUCCEEDED" || checkout.status === "CANCELLED") return;
    const card = selectedCard;
    const attempt = checkout.attemptCount + 1;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await submitSamplePayment({
          checkoutId: checkout.id,
          card,
          attempt,
        });
        if (result.data) {
          notifyMarketplace(result.data.status);
          setCheckout(result.data);
          setRetrying(result.data.status !== "FAILED");
          setMessage(result.data.status === "FAILED" ? "The sample payment was declined." : "");
          if (result.data.status === "SUCCEEDED") setSelectedCard(null);
        } else {
          setMessage(result.error ?? "Unable to process the sample payment. Please try again.");
        }
      } catch {
        setMessage("We couldn’t complete that sample attempt. Please try again.");
      }
    });
  }

  function cancelCheckout() {
    if (isPending || isTerminal) return;
    startTransition(async () => {
      try {
        const result = await cancelSamplePayment({ checkoutId: checkout.id });
        if (result.data) {
          notifyMarketplace(result.data.status);
          setCheckout(result.data);
        }
        if (result.error) {
          setMessage(result.error);
          return;
        }
        router.push(result.data?.returnUrl ?? checkout.returnUrl);
      } catch {
        setMessage("We couldn’t close this sample checkout. Please try again.");
      }
    });
  }

  function continueToMarketplace() {
    router.push(checkout.returnUrl);
  }

  const terminalSuccess = checkout.status === "SUCCEEDED";
  const terminalCancel = checkout.status === "CANCELLED";
  const declined = checkout.status === "FAILED";

  useEffect(() => {
    if (!terminalSuccess || handoffEvent) return;
    setHandoffEvent(createPaymentReturnEvent({
      status: "success",
      context: sampleReturnContext(checkout.kind),
      sampleCheckoutId: checkout.id,
    }));
  }, [checkout.id, checkout.kind, handoffEvent, terminalSuccess]);

  return (
    <main className="flowpay-page font-body">
      <h1 className="flowpay-logo">FlowPay</h1>
      <p className="flowpay-sample">Sample payment — no money will be charged</p>

      <div className="flowpay-frame">
        <div className="flowpay-watermark" aria-hidden="true">
          <span className="flowpay-watermark-left">SAMPLE</span>
          <span className="flowpay-watermark-right">PAYMENT</span>
        </div>
      <section className="flowpay-panel" aria-label="Sample card checkout">
        <header className="flowpay-order">
          <div><strong>{checkout.description}</strong><small>Order: {checkout.id.slice(-8).toUpperCase()}</small></div>
          <div className="flowpay-amount"><small>{checkout.currency.toUpperCase()}</small><span>{formattedAmount.replace(/^[^\d]+/, "")}</span></div>
        </header>
        <div className="flowpay-cardbar">
          <button type="button" onClick={isTerminal ? continueToMarketplace : cancelCheckout} disabled={isPending}>‹ Back</button>
          <span>Card</span>
          <CreditCard size={24} aria-hidden="true" />
        </div>

        <div className="flowpay-content">
          {terminalSuccess ? (
            <div className="flowpay-result" role="status">
              <strong>Sample payment approved</strong>
              <p>
                {showReturnFallback
                  ? "This tab stayed open. Return to your original itrader tab."
                  : "No money was charged. Updating your original itrader tab…"}
              </p>
              {showReturnFallback ? (
                <button type="button" className="flowpay-pay" onClick={continueToMarketplace}>
                  Return to itrader
                </button>
              ) : null}
            </div>
          ) : terminalCancel ? (
            <div className="flowpay-result" role="status">
              <strong>Checkout cancelled</strong>
              <p>No money was charged.</p>
            </div>
          ) : declined && !retrying ? (
            <div className="flowpay-result flowpay-error" role="alert">
              <strong>Sample card declined</strong>
              <p>{message || "The sample payment was declined."}</p>
              <p>{checkout.attemptCount} of 3 sample attempts used.</p>
              {attemptsLeft > 0 && !isExpired ? (
                <button type="button" className="flowpay-pay" onClick={() => { setRetrying(true); setSelectedCard(null); setMessage(""); }}>Retry</button>
              ) : <p>Return to iTrader to start another sample checkout.</p>}
            </div>
          ) : (
            <>
              <fieldset className="flowpay-saved" role="radiogroup" aria-label="Use your saved card to pay">
                <legend>Use your saved card to pay</legend>
                <label className="flowpay-saved-card">
                  <input type="radio" name="sample-card" value="approve" checked={selectedCard === "approve"} onChange={() => setSelectedCard("approve")} disabled={isPending || attemptsLeft === 0 || isExpired} />
                  <span><span className="flowpay-cardnumber">424242••••••4242</span><small>Successful payment</small></span>
                  <span className="flowpay-outcome">Approves</span>
                </label>
                <label className="flowpay-saved-card">
                  <input type="radio" name="sample-card" value="decline" checked={selectedCard === "decline"} onChange={() => setSelectedCard("decline")} disabled={isPending || attemptsLeft === 0 || isExpired} />
                  <span><span className="flowpay-cardnumber">400000••••••0002</span><small>Declined payment</small></span>
                  <span className="flowpay-outcome">Declines</span>
                </label>
              </fieldset>

              <fieldset className="flowpay-entry" disabled aria-describedby="sample-card-note">
                <legend>Use a new card <span>Unavailable in sample checkout</span></legend>
                <label>Card Number<input type="text" placeholder="0000 0000 0000 0000" disabled autoComplete="off" /></label>
                <div className="flowpay-expiry">
                  <label>Expiration Month<select disabled defaultValue=""><option value="">MM</option></select></label>
                  <label>Expiration Year<select disabled defaultValue=""><option value="">YY</option></select></label>
                </div>
                <label className="flowpay-security">Security code<input type="text" placeholder="000" disabled autoComplete="off" /></label>
              </fieldset>
              <p className="flowpay-note" id="sample-card-note">Select a saved sample card above. Real card details cannot be entered.</p>
              {message ? <p className="flowpay-error" role="alert">{message}</p> : null}
              {isExpired ? <p className="flowpay-error" role="status">This sample checkout has expired. Return to iTrader to start again.</p> : null}
              <button type="button" className="flowpay-pay" disabled={!selectedCard || isPending || attemptsLeft === 0 || isExpired} onClick={submitPayment}>
                {isPending ? "Processing…" : "Pay using Card"}
              </button>
            </>
          )}
          {isTerminal ? <button type="button" className="flowpay-pay" onClick={continueToMarketplace}>Continue to iTrader</button>
            : <button type="button" className="flowpay-cancel" onClick={cancelCheckout} disabled={isPending}>Cancel payment</button>}
        </div>
      </section>
      </div>
      <footer className="flowpay-footer">FlowPay is a sample checkout for iTrader.<br />No real payments or card details are processed.</footer>
      <style jsx global>{`
        .flowpay-page{min-height:100vh;background:#f8f8f7;color:#3d4149;padding:24px 16px 36px;font-family:Arial,sans-serif;font-size:13px;color-scheme:light}
        .flowpay-logo{margin:0 auto 10px;text-align:center;color:#24164e;font-family:Arial,sans-serif!important;font-size:34px;font-weight:750;letter-spacing:-1.7px;line-height:1.2}
        .flowpay-sample{margin:0 auto 20px;text-align:center;color:#665581;font-size:11px}
        .flowpay-frame{position:relative;max-width:340px;margin:0 auto}
        .flowpay-watermark{pointer-events:none;user-select:none;color:#d6d5d8;font:700 72px/1 Arial,sans-serif;letter-spacing:5px}
        .flowpay-watermark span{position:absolute;top:50%;writing-mode:vertical-rl;white-space:nowrap}
        .flowpay-watermark-left{right:calc(100% + 24px);transform:translateY(-50%) rotate(180deg)}
        .flowpay-watermark-right{left:calc(100% + 24px);transform:translateY(-50%)}
        .flowpay-panel{max-width:340px;margin:0 auto;background:#fff;border-radius:3px;box-shadow:0 2px 10px #00000012;overflow:hidden}
        .flowpay-order{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:15px 20px;background:#24164e;color:white}
        .flowpay-order strong{display:block;font-size:13px;line-height:1.4;font-weight:600;overflow-wrap:anywhere}
        .flowpay-order small{display:block;font-size:10px;margin-top:3px}
        .flowpay-amount{display:flex;align-items:baseline;gap:4px;flex-shrink:0}
        .flowpay-amount span{font-size:25px;line-height:1;font-weight:400;letter-spacing:-.6px}
        .flowpay-cardbar{height:49px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eee;font-size:13px}
        .flowpay-cardbar button,.flowpay-cancel{border:0;background:none;color:#e45c6d;cursor:pointer;font:inherit}
        .flowpay-cardbar button{font-size:12px;padding:8px 0}
        .flowpay-cardbar svg{color:#69acb3;transform:rotate(-18deg)}
        .flowpay-content{padding:21px 22px 23px}
        .flowpay-saved,.flowpay-entry{min-width:0;border:0;margin:0;padding:0}
        .flowpay-saved legend{font-size:13px;margin-bottom:13px}
        .flowpay-saved-card{display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 13px}
        .flowpay-saved-card input{width:15px;height:15px;margin:0;accent-color:#9876c8;flex-shrink:0}
        .flowpay-saved-card>span:nth-child(2){flex:1;min-width:0}
        .flowpay-cardnumber{white-space:nowrap;font-size:12px}
        .flowpay-saved-card small{display:block;font-size:10px;color:#777;margin-top:3px}
        .flowpay-outcome{color:#777;font-size:10px}
        .flowpay-entry{border-top:1px solid #eee;margin-top:18px;padding-top:15px}
        .flowpay-entry legend{float:left;width:100%;font-size:12px;color:#85858b;margin-bottom:14px}
        .flowpay-entry legend span{display:block;font-size:10px;margin-top:3px}
        .flowpay-entry label{display:block;font-size:12px;clear:both;color:#74747b}
        .flowpay-entry input,.flowpay-entry select{display:block;box-sizing:border-box;width:100%;height:35px;margin:7px 0 15px;border:1px solid #ddd8d7;border-radius:2px;padding:6px 10px;background:#f7f7f7;color:#999;font:inherit;cursor:not-allowed;opacity:1}
        .flowpay-entry input::placeholder{color:#aaa}
        .flowpay-expiry{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .flowpay-security{max-width:125px}
        .flowpay-note{font-size:10px;line-height:1.5;color:#78727e;margin:0 0 22px}
        .flowpay-pay{display:block;width:100%;min-height:39px;border:0;border-radius:24px;background:#aa8dd3;color:#fff;font:600 13px Arial,sans-serif;padding:10px 14px;cursor:pointer}
        .flowpay-pay:hover:not(:disabled){background:#9574c2}
        .flowpay-pay:disabled{opacity:.5;cursor:not-allowed}
        .flowpay-cancel{display:block;margin:19px auto 0;font-size:12px;padding:3px 8px}
        .flowpay-cancel:disabled,.flowpay-cardbar button:disabled{opacity:.5;cursor:not-allowed}
        .flowpay-result{font-size:13px;line-height:1.6;padding:6px 0 12px}
        .flowpay-result p{margin:10px 0 15px}
        .flowpay-error{color:#a04454;font-size:12px;line-height:1.5}
        .flowpay-footer{max-width:340px;margin:24px auto 0;text-align:center;font-size:10px;line-height:1.7;color:#67616d}
        .flowpay-page button:focus-visible,.flowpay-page input:focus-visible{outline:2px solid #7852a8;outline-offset:3px}
        @media(max-width:600px){.flowpay-watermark{display:flex;justify-content:center;gap:9px;font-size:24px;letter-spacing:3px;margin-bottom:14px}.flowpay-watermark span{position:static;writing-mode:horizontal-tb;transform:none}}
        @media(max-width:380px){.flowpay-page{padding:20px 12px 28px}.flowpay-content{padding:19px 18px}.flowpay-order{padding:14px 18px}}
      `}</style>
    </main>
  );
}
