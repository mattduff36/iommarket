"use client";

import { useState } from "react";

type Props = {
  email: string;
  listing: string;
  disabled: boolean;
  expired: boolean;
  error: string;
  onConfirm: () => void;
};

/** Temporary FlowPay rehearsal. Only the existing DEV checkout action fulfils the upgrade. */
export function SampleReceiptConfirmation({ email, listing, disabled, expired, error, onConfirm }: Props) {
  const [code, setCode] = useState("");
  const [entered, setEntered] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);

  function sendCode() {
    setCode((previous) => previous || crypto.randomUUID().replaceAll("-", "").slice(-16));
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Authorise your Featured upgrade</h2>
      <p>Your receipt email differs from your iTrader account. Send a code to the mock inbox to confirm this sample upgrade.</p>
      <button className="flowpay-pay" type="button" disabled={disabled} onClick={sendCode}>Send authorisation code</button>
      {code && (
        <div>
          <p role="status">Code sent to the mock inbox.</p>
          <button className="underline" type="button" aria-expanded={inboxOpen} onClick={() => setInboxOpen(!inboxOpen)}>
            {inboxOpen ? "Close mock inbox" : "Open mock inbox"}
          </button>
          {inboxOpen && (
            <article aria-label="Mock receipt email" className="mt-2 space-y-2 rounded border border-gray-300 bg-gray-50 p-3">
              <p className="break-all">To: {email}</p>
              <strong>Authorise your iTrader Featured listing upgrade</strong>
              <p>{listing}</p>
              <p>Your authorisation code is <code className="select-all font-bold">{code}</code>.</p>
            </article>
          )}
        </div>
      )}
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        if (!code || entered.trim().toLowerCase() !== code) {
          setInvalid(true);
          return;
        }
        onConfirm();
      }}>
        <label className="block">Authorisation code
          <input className="mt-1 block w-full rounded border border-gray-400 bg-white px-3 py-2"
            value={entered} onChange={(event) => { setEntered(event.target.value); setInvalid(false); }}
            maxLength={32} autoComplete="off" required />
        </label>
        {invalid && <p role="alert">That code did not match. Check the mock inbox and try again.</p>}
        {(error || expired) && <p role="alert">{expired ? "This sample checkout has expired." : error}</p>}
        <button className="flowpay-pay" disabled={disabled || !code}>Confirm Featured upgrade</button>
      </form>
    </section>
  );
}
