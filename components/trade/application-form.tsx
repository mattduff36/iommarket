"use client";

import { Input } from "@/components/ui/input";
import { submitTradeApplicationAction } from "@/actions/trade/membership";
import { TradeForm, tradeFieldClass } from "@/components/trade/trade-form";

const ENTITY_TYPES = [
  ["REGISTERED_COMPANY", "Registered company"],
  ["REGISTERED_BUSINESS_NAME", "Registered business name"],
  ["SOLE_TRADER_OR_PARTNERSHIP", "Sole trader or partnership"],
  ["OTHER", "Other"],
] as const;

function RequiredMark() {
  return <span aria-hidden="true" className="text-text-error"> *</span>;
}

export function TradeApplicationForm() {
  return (
    <TradeForm action={submitTradeApplicationAction} submitLabel="Submit application">
      <p className="text-sm text-text-secondary">
        These details let iTrader check that you trade vehicles and can act for the business. They are not shown to other dealers. A registration number does not approve the application by itself.
      </p>
      <Input name="businessName" label="Trading name" required helperText="The name other dealers may see after you are approved." />
      <Input name="legalEntityName" label="Legal entity name" helperText="If it differs from the trading name." />
      <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
        <span>Business type<RequiredMark /></span>
        <select name="entityType" required aria-required="true" className={tradeFieldClass} defaultValue="REGISTERED_COMPANY">
          {ENTITY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <Input name="registrationIdentifier" label="Company or business registration" helperText="Optional. Use the registry format, including letters. Sole traders can leave this blank." />
      <Input name="tradingAddress" label="Trading address" required />
      <Input name="website" label="Website or public trading page" type="url" helperText="Optional public evidence that the business trades vehicles." />
      <Input name="contactName" label="Your name" required />
      <Input name="roleDeclaration" label="Your role" required helperText="For example, director or sales manager." />
      <Input name="workEmail" label="Work email" type="email" required helperText="Used as a business contact on the application, not emailed with documents." />
      <Input name="phone" label="Work phone" required />
      <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
        <span>What vehicle trading does the business do?<RequiredMark /></span>
        <textarea name="activityDescription" required aria-required="true" minLength={10} rows={4} className={tradeFieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
        Optional evidence
        <input name="evidence" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-sm" />
        <span className="font-normal text-text-secondary">PDF or image, only if you want to include one. iTrader stores it privately for admins.</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-text-primary">
        <input type="checkbox" name="authorityConfirmed" required className="mt-1" />
        <span>I am 18 or over and authorised to apply for this business.<RequiredMark /></span>
      </label>
    </TradeForm>
  );
}
