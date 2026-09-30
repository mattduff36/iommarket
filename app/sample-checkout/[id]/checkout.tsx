"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  cancelSamplePayment,
  submitSamplePayment,
} from "@/actions/sample-payments";
import type { SampleCheckoutView } from "@/lib/payments/sample-checkout";

type CardChoice = "approve" | "decline";

function formatAmount(amountPence: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}

function paymentLabel(checkout: SampleCheckoutView) {
  switch (checkout.kind) {
    case "listing_payment":
      return "Private listing";
    case "featured_upgrade":
      return "Featured upgrade";
    case "dealer_subscription":
      return "Dealer subscription";
  }
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

  function notifyMarketplace() {
    try {
      window.localStorage.setItem("itrader:payment-update", String(Date.now()));
    } catch {
      // The sample checkout result remains authoritative when storage is unavailable.
    }
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
        notifyMarketplace();
        if (result.data) {
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
        notifyMarketplace();
        if (result.data) setCheckout(result.data);
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
    if (!terminalSuccess) return;
    const timer = window.setTimeout(() => router.push(checkout.returnUrl), 1500);
    return () => window.clearTimeout(timer);
  }, [checkout.returnUrl, router, terminalSuccess]);

  return (
    <main className="flowpay-page font-body">
      <div className="flowpay-topbar">
        <a className="flowpay-brand" href={checkout.returnUrl} aria-label="FlowPay sample checkout">
          <span className="flowpay-mark"><span /><span /><span /></span>
          <span>flowpay</span>
          <span className="flowpay-environment">SAMPLE</span>
        </a>
        <div className="flowpay-topnote"><LockKeyhole size={14} strokeWidth={2.2} /> Secure sample environment</div>
      </div>

      <div className="flowpay-banner" role="note">
        <span className="flowpay-banner-icon"><ShieldCheck size={17} /></span>
        <span><strong>Sample payment · no money charged</strong><span>This checkout is for testing only. No real card details are requested or processed.</span></span>
      </div>

      <div className="flowpay-shell">
        <section className="flowpay-main" aria-labelledby="checkout-title">
          <div className="flowpay-step"><span className="flowpay-step-dot">{terminalSuccess ? <Check size={14} /> : "1"}</span><span>PAYMENT</span><i /><span className="flowpay-step-muted">CONFIRMATION</span></div>

          <div className="flowpay-heading">
            <p className="flowpay-eyebrow">{paymentLabel(checkout)} <span>·</span> Sample checkout</p>
            <h1 id="checkout-title">{terminalSuccess ? "Payment approved" : declined ? "Try another sample outcome" : terminalCancel ? "Checkout closed" : "Choose a test card"}</h1>
            <p className="flowpay-intro">{terminalSuccess ? "The sample flow is complete. You can return to iTrader now." : terminalCancel ? "This sample checkout has been closed." : "Select a simulated result to see how a payment provider response is handled."}</p>
          </div>

          {terminalSuccess ? (
            <div className="flowpay-result flowpay-result-success" role="status">
              <span className="flowpay-result-icon"><Check size={20} /></span><div><strong>Sample payment approved</strong><p>No money was charged. The iTrader preview will receive a successful sample result.</p></div>
            </div>
          ) : terminalCancel ? (
            <div className="flowpay-result" role="status">
              <span className="flowpay-result-icon muted"><X size={19} /></span><div><strong>Checkout cancelled</strong><p>You can return to iTrader and continue from where you left off.</p></div>
            </div>
          ) : declined && !retrying ? (
            <div className="flowpay-result flowpay-result-error" role="alert">
              <span className="flowpay-result-icon"><X size={19} /></span><div><strong>Sample card declined</strong><p>{message || "The sample card was declined. No money was charged."}</p>
                <p className="flowpay-failure-count">{checkout.attemptCount} of 3 sample attempts used · {attemptsLeft} remaining</p>
                <div className="flowpay-failure-actions">
                  {attemptsLeft > 0 && !isExpired ? <button type="button" className="flowpay-retry" onClick={() => { setRetrying(true); setSelectedCard(null); setMessage(""); }}><RotateCcw size={14} /> Retry</button> : null}
                  <button type="button" className="flowpay-retry flowpay-retry-muted" onClick={cancelCheckout} disabled={isPending}><X size={14} /> Cancel payment</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flowpay-section-label"><span>SIMULATED CARD OUTCOME</span><span>Choose one</span></div>
              <div className="flowpay-cards" role="radiogroup" aria-label="Choose a sample card outcome">
                <button type="button" className={`flowpay-card ${selectedCard === "approve" ? "is-selected" : ""}`} onClick={() => setSelectedCard("approve")} role="radio" aria-checked={selectedCard === "approve"} disabled={isPending || attemptsLeft === 0 || isExpired}>
                  <span className="flowpay-radio" />
                  <span className="flowpay-card-copy"><strong>Successful payment</strong><span>Simulate an approved card</span><code>•••• &nbsp;•••• &nbsp;•••• &nbsp;4242</code></span>
                  <span className="flowpay-card-outcome approved"><Check size={13} /> APPROVES</span>
                </button>
                <button type="button" className={`flowpay-card ${selectedCard === "decline" ? "is-selected" : ""}`} onClick={() => setSelectedCard("decline")} role="radio" aria-checked={selectedCard === "decline"} disabled={isPending || attemptsLeft === 0 || isExpired}>
                  <span className="flowpay-radio" />
                  <span className="flowpay-card-copy"><strong>Declined payment</strong><span>Simulate a card refusal</span><code>•••• &nbsp;•••• &nbsp;•••• &nbsp;0002</code></span>
                  <span className="flowpay-card-outcome declined"><X size={13} /> DECLINES</span>
                </button>
              </div>

              <div className="flowpay-test-note"><CircleHelp size={16} /><span>These are sample outcomes. Card details are never sent or stored.</span></div>
              {message ? <p className="flowpay-inline-error" role="alert">{message}</p> : null}
              {isExpired ? <p className="flowpay-attempt-cap" role="status">This sample checkout has expired. Cancel payment to return to iTrader.</p> : null}
              {attemptsLeft === 0 ? <p className="flowpay-attempt-cap">The sample limit of 3 attempts has been reached. Continue to iTrader to start again.</p> : null}

              <button type="button" className="flowpay-primary" disabled={!selectedCard || isPending || attemptsLeft === 0 || isExpired} onClick={submitPayment}>
                {isPending ? <><span className="flowpay-spinner" aria-hidden="true" /> Sending sample result…</> : <>Pay {formattedAmount} <ArrowRight size={17} /></>}
              </button>
              <p className="flowpay-attempts">{checkout.attemptCount} of 3 sample attempts used <span>·</span> {attemptsLeft} remaining</p>
              <p className="flowpay-expiry">Sample checkout expires {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(checkout.expiresAt))} UK time</p>
              {declined ? <button type="button" className="flowpay-cancel" onClick={cancelCheckout} disabled={isPending}><X size={14} /> Cancel payment</button> : null}
            </>
          )}

          {isTerminal ? (
            <button type="button" className="flowpay-primary" onClick={continueToMarketplace}>Continue to iTrader <ArrowRight size={17} /></button>
          ) : null}

          {!isTerminal && !declined ? (
            <button
              type="button"
              className="flowpay-cancel"
              onClick={declined && attemptsLeft > 0
                ? () => { setSelectedCard(null); setMessage(""); }
                : cancelCheckout}
              disabled={isPending}
            >
              <><X size={14} /> Cancel payment</>
            </button>
          ) : null}
        </section>

        <aside className="flowpay-summary" aria-label="Payment summary">
          <div className="flowpay-summary-head"><span>ORDER SUMMARY</span><span className="flowpay-secure"><LockKeyhole size={12} /> SECURE</span></div>
          <div className="flowpay-merchant"><span className="flowpay-merchant-logo">i</span><span><strong>iTrader</strong><small>Isle of Man marketplace</small></span><ChevronRight size={15} /></div>
          <div className="flowpay-summary-line"><span>{checkout.description}</span><strong>{formatAmount(checkout.amountPence, checkout.currency)}</strong></div>
          <div className="flowpay-summary-line flowpay-summary-sub"><span>Sample checkout</span><span>£0.00 charged</span></div>
          <div className="flowpay-total"><span>Total</span><strong>{formatAmount(checkout.amountPence, checkout.currency)}</strong></div>
          <div className="flowpay-total-note">Displayed total is illustrative only</div>
          <div className="flowpay-summary-foot"><ShieldCheck size={15} /><span>Protected sample environment</span></div>
        </aside>
      </div>

      <footer className="flowpay-footer"><span>© {new Date().getFullYear()} FlowPay sample</span><span>FlowPay Sample · Testing only <i /> No live processing</span></footer>

      <style jsx global>{`
        .flowpay-page{--fp-ink:#25213a;--fp-muted:#78748b;--fp-lav:#7864d8;--fp-border:#e9e6f1;--fp-bg:#fbfaff;min-height:100vh;background:radial-gradient(ellipse at 48% -24%,#f0edff 0,transparent 48%),var(--fp-bg);color:var(--fp-ink);font-family:var(--font-body),sans-serif;padding:0 28px}
        .flowpay-topbar{max-width:1080px;height:76px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eeecf4}.flowpay-brand{display:flex;align-items:center;gap:10px;color:var(--fp-ink);font-weight:750;font-size:21px;letter-spacing:-.8px;text-decoration:none}.flowpay-mark{width:27px;height:27px;border-radius:9px;background:#7966da;display:flex;align-items:flex-end;justify-content:center;gap:2px;padding:6px}.flowpay-mark span{display:block;width:3px;border-radius:3px;background:white}.flowpay-mark span:nth-child(1){height:8px;opacity:.7}.flowpay-mark span:nth-child(2){height:12px}.flowpay-mark span:nth-child(3){height:6px;opacity:.8}.flowpay-environment{margin-left:2px;padding:4px 6px;border-radius:5px;background:#efedfb;color:#7362c8;font-size:9px;font-weight:800;letter-spacing:.8px}.flowpay-topnote{display:flex;align-items:center;gap:7px;color:#767287;font-size:12px;font-weight:550}
        .flowpay-banner{max-width:1080px;margin:24px auto 0;border:1px solid #e3defa;border-radius:10px;background:#f5f2ff;padding:13px 17px;display:flex;align-items:center;gap:12px;color:#514687}.flowpay-banner-icon{width:30px;height:30px;border-radius:9px;background:#e9e4ff;color:#7662d5;display:grid;place-items:center;flex:none}.flowpay-banner strong,.flowpay-banner span span{display:block}.flowpay-banner strong{font-size:12px;font-weight:750;letter-spacing:.12px}.flowpay-banner span span{margin-top:2px;font-size:11px;color:#746d98}
        .flowpay-shell{max-width:970px;margin:37px auto 30px;display:grid;grid-template-columns:minmax(0,1.28fr) minmax(280px,.72fr);gap:54px;align-items:start}.flowpay-main{padding:0 0 16px}.flowpay-step{height:29px;display:flex;align-items:center;gap:9px;color:#7162c3;font-size:9px;letter-spacing:1.35px;font-weight:800}.flowpay-step-dot{width:19px;height:19px;border-radius:50%;background:#7563d2;color:white;display:grid;place-items:center;font-size:10px;letter-spacing:0}.flowpay-step i{width:27px;height:1px;background:#e1deea;margin:0 3px}.flowpay-step-muted{color:#a6a2b2}.flowpay-heading{margin:26px 0 27px}.flowpay-eyebrow{margin:0 0 9px;color:#7564ce;font-size:11px;font-weight:700;letter-spacing:.2px}.flowpay-eyebrow span{padding:0 3px;color:#b2accd}.flowpay-heading h1{margin:0;color:#26223a;font-size:32px;line-height:1.15;letter-spacing:-1.2px;font-weight:690}.flowpay-intro{margin:10px 0 0;color:#777387;font-size:13px;line-height:1.55;max-width:490px}
        .flowpay-section-label{display:flex;justify-content:space-between;align-items:center;margin:0 0 11px;color:#767287;font-size:9px;font-weight:800;letter-spacing:1px}.flowpay-section-label span+span{font-weight:550;letter-spacing:0;color:#aaa6b6;font-size:11px}.flowpay-cards{display:grid;gap:10px}.flowpay-card{width:100%;min-height:91px;background:#fff;border:1px solid #e8e6ef;border-radius:11px;padding:15px;display:flex;align-items:center;text-align:left;gap:13px;cursor:pointer;color:var(--fp-ink);transition:border-color .16s,box-shadow .16s,transform .16s}.flowpay-card:hover:not(:disabled){border-color:#bdb3ed;transform:translateY(-1px)}.flowpay-card.is-selected{border-color:#8270db;box-shadow:0 0 0 3px #8270db19;background:#fefeff}.flowpay-card:disabled{opacity:.52;cursor:not-allowed}.flowpay-radio{width:17px;height:17px;border:1.5px solid #c9c6d4;border-radius:50%;display:grid;place-items:center;flex:none}.is-selected .flowpay-radio{border-color:#7563d2}.is-selected .flowpay-radio:after{content:"";width:8px;height:8px;border-radius:50%;background:#7563d2}.flowpay-card-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}.flowpay-card-copy strong{font-size:13px;font-weight:700}.flowpay-card-copy>span{font-size:11px;color:#898598}.flowpay-card-copy code{margin-top:5px;color:#555168;font-size:11px;letter-spacing:1.15px;font-weight:650;font-family:var(--font-body),sans-serif}.flowpay-card-outcome{display:inline-flex;align-items:center;gap:4px;border-radius:5px;padding:5px 7px;font-size:8px;font-weight:800;letter-spacing:.55px;white-space:nowrap}.flowpay-card-outcome.approved{color:#328365;background:#edf8f3}.flowpay-card-outcome.declined{color:#aa6572;background:#fbf0f2}
        .flowpay-test-note{margin:13px 0 21px;display:flex;align-items:center;gap:8px;color:#898598;font-size:10px}.flowpay-test-note svg{color:#9185c9;flex:none}.flowpay-primary{min-height:48px;width:100%;border:0;border-radius:9px;background:#7563d2;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;box-shadow:0 5px 12px #7160c326;transition:background .15s,transform .15s}.flowpay-primary:hover:not(:disabled){background:#6652c4;transform:translateY(-1px)}.flowpay-primary:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}.flowpay-spinner{width:15px;height:15px;border:2px solid #ffffff72;border-top-color:#fff;border-radius:50%;animation:flowpay-spin .7s linear infinite}@keyframes flowpay-spin{to{transform:rotate(360deg)}}.flowpay-attempts{text-align:center;margin:9px 0 0;color:#a19dad;font-size:10px}.flowpay-attempts span{padding:0 4px;color:#c4c0ce}.flowpay-cancel{margin:18px auto 0;border:0;background:none;color:#827c90;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}.flowpay-cancel:hover:not(:disabled){color:#6152b2}.flowpay-cancel:disabled{opacity:.45;cursor:not-allowed}.flowpay-inline-error,.flowpay-attempt-cap{text-align:center;font-size:11px;color:#ad5668;margin:0 0 11px}.flowpay-attempt-cap{color:#756d85}
        .flowpay-expiry{text-align:center;margin:8px 0 0;color:#a19dad;font-size:10px}.flowpay-failure-count{font-size:10px!important;color:#a19dad!important}.flowpay-failure-actions{display:flex;align-items:center;gap:16px;margin-top:13px}.flowpay-retry{border:0;background:none;padding:3px 0;color:#6652c4;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px;cursor:pointer}.flowpay-retry:hover:not(:disabled){color:#5140a6}.flowpay-retry-muted{color:#827c90}.flowpay-retry:disabled{opacity:.5;cursor:not-allowed}
        .flowpay-result{display:flex;gap:12px;align-items:flex-start;border:1px solid #e9e6f1;background:#fff;border-radius:10px;padding:16px;margin:0 0 20px}.flowpay-result-success{border-color:#d6eddf;background:#f5fbf7}.flowpay-result-error{border-color:#f1dfe2;background:#fff8f9}.flowpay-result-icon{width:30px;height:30px;border-radius:9px;background:#ece9f9;color:#7662cf;display:grid;place-items:center;flex:none}.flowpay-result-success .flowpay-result-icon{background:#e2f4e9;color:#35815e}.flowpay-result-error .flowpay-result-icon{background:#f9e8eb;color:#b15f6c}.flowpay-result-icon.muted{background:#f0eef4;color:#837e91}.flowpay-result strong{display:block;padding-top:2px;font-size:12px}.flowpay-result p{margin:5px 0 0;color:#777387;font-size:11px;line-height:1.5}
        .flowpay-summary{margin-top:30px;border:1px solid #e9e6f0;border-radius:12px;background:#fff;box-shadow:0 12px 38px #3b2f7010;overflow:hidden}.flowpay-summary-head{height:46px;border-bottom:1px solid #f0eef4;display:flex;align-items:center;justify-content:space-between;padding:0 17px;color:#898598;font-size:9px;font-weight:800;letter-spacing:1.1px}.flowpay-secure{display:flex;align-items:center;gap:4px;font-size:8px;color:#8373c9;letter-spacing:.65px}.flowpay-merchant{display:flex;align-items:center;gap:10px;padding:16px 17px 14px;border-bottom:1px solid #f2f0f5}.flowpay-merchant-logo{width:33px;height:33px;border-radius:10px;background:#f0edfc;color:#7662ce;display:grid;place-items:center;font-weight:800;font-size:19px;font-family:Georgia,serif}.flowpay-merchant>span:nth-child(2){display:flex;flex-direction:column;gap:3px;flex:1}.flowpay-merchant strong{font-size:12px}.flowpay-merchant small{font-size:10px;color:#918c9e}.flowpay-merchant>svg{color:#b3afbd}.flowpay-summary-line{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:17px 17px 12px;font-size:11px;color:#747083;line-height:1.4}.flowpay-summary-line strong{color:#37334a;font-size:12px;white-space:nowrap}.flowpay-summary-sub{padding-top:2px;padding-bottom:17px;color:#a09baa;font-size:10px}.flowpay-total{margin:0 17px;padding:15px 0;border-top:1px solid #efedf3;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:650}.flowpay-total strong{font-size:17px;letter-spacing:-.3px}.flowpay-total-note{padding:0 17px 15px;text-align:right;color:#a19dac;font-size:9px}.flowpay-summary-foot{border-top:1px solid #f0eef4;background:#fcfbfe;padding:12px 17px;display:flex;align-items:center;gap:7px;color:#8b859b;font-size:10px}.flowpay-summary-foot svg{color:#8a7bd1}
        .flowpay-footer{max-width:1080px;margin:0 auto;border-top:1px solid #eeecf4;min-height:56px;display:flex;justify-content:space-between;align-items:center;color:#a09baa;font-size:10px}.flowpay-footer span+span{display:flex;align-items:center;gap:7px}.flowpay-footer i{width:4px;height:4px;border-radius:50%;background:#84bd9a;display:block}
        @media(max-width:720px){.flowpay-page{padding:0 18px}.flowpay-topbar{height:65px}.flowpay-topnote{font-size:0}.flowpay-topnote svg{width:17px;height:17px}.flowpay-banner{margin-top:17px;padding:11px 12px}.flowpay-banner span span{font-size:10px}.flowpay-shell{grid-template-columns:1fr;gap:13px;margin-top:26px}.flowpay-heading{margin:22px 0 25px}.flowpay-heading h1{font-size:28px}.flowpay-summary{margin-top:4px;grid-row:2}.flowpay-main{grid-row:1}.flowpay-footer{margin-top:13px;min-height:53px}.flowpay-footer span+span{font-size:0}.flowpay-footer i{width:6px;height:6px}.flowpay-card{padding:13px;gap:10px}.flowpay-card-outcome{font-size:7px;padding:5px}.flowpay-section-label{font-size:8px}}
        @media(prefers-reduced-motion:reduce){.flowpay-card,.flowpay-primary{transition:none}.flowpay-spinner{animation-duration:1.6s}}
      `}</style>
    </main>
  );
}
