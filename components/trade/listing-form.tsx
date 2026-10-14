"use client";

import { Input } from "@/components/ui/input";
import { TradeForm, tradeFieldClass } from "@/components/trade/trade-form";
import { TRADE_FUELS, TRADE_TRANSMISSIONS } from "@/lib/trade-exchange/constants";

export interface TradeListingFormValues {
  make?: string;
  model?: string;
  year?: number;
  mileage?: number;
  transmission?: string;
  fuel?: string;
  conditionSummary?: string;
  disclosedDefects?: string;
  serviceHistory?: string | null;
  motStatus?: string | null;
  priceType?: string;
  pricePence?: number | null;
  vatTreatment?: string;
  registrationNumber?: string | null;
  vin?: string | null;
  locationLabel?: string;
  notes?: string | null;
  contactPreference?: string;
  availabilityNote?: string | null;
  ownershipDeclared?: boolean;
  authorityDeclared?: boolean;
  mileageDeclared?: boolean;
  conditionDeclared?: boolean;
  notWrittenOffDeclared?: boolean;
}

function SelectField({ name, label, options, defaultValue }: { name: string; label: string; options: readonly string[]; defaultValue?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
      {label}
      <select name={name} defaultValue={defaultValue} required className={tradeFieldClass}>
        {options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
      </select>
    </label>
  );
}

export function TradeListingForm({
  action,
  submitLabel,
  initial,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | { ok?: boolean } | void>;
  submitLabel: string;
  initial?: TradeListingFormValues;
}) {
  const price = initial?.pricePence != null ? (initial.pricePence / 100).toFixed(2) : "";
  return (
    <TradeForm action={action} submitLabel={submitLabel}>
      <input type="hidden" name="writeOff" value="NONE" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="make" label="Make" required defaultValue={initial?.make} />
        <Input name="model" label="Model" required defaultValue={initial?.model} />
        <Input name="year" label="Year" type="number" required defaultValue={initial?.year} />
        <Input name="mileage" label="Mileage" type="number" required defaultValue={initial?.mileage} />
        <SelectField name="transmission" label="Transmission" options={TRADE_TRANSMISSIONS} defaultValue={initial?.transmission ?? "Manual"} />
        <SelectField name="fuel" label="Fuel" options={TRADE_FUELS} defaultValue={initial?.fuel ?? "Petrol"} />
        <Input name="conditionSummary" label="Condition" required defaultValue={initial?.conditionSummary} helperText="A short condition description other dealers can scan." />
        <Input name="locationLabel" label="Location" required defaultValue={initial?.locationLabel} />
        <SelectField name="priceType" label="Price type" options={["FIXED", "POA", "OFFERS_INVITED"]} defaultValue={initial?.priceType ?? "FIXED"} />
        <Input name="priceGbp" label="Fixed price (£)" defaultValue={price} helperText="Required only for a fixed price. Leave empty for POA or offers invited." />
        <SelectField name="vatTreatment" label="VAT treatment" options={["PLUS_VAT", "VAT_INCLUDED", "NO_VAT", "NOT_STATED"]} defaultValue={initial?.vatTreatment ?? "NOT_STATED"} />
        <SelectField name="contactPreference" label="Contact preference" options={["MESSAGE", "PHONE", "EITHER"]} defaultValue={initial?.contactPreference ?? "MESSAGE"} />
        <Input name="registrationNumber" label="Registration" defaultValue={initial?.registrationNumber ?? ""} helperText="Shown only to you and iTrader admins." />
        <Input name="vin" label="VIN" defaultValue={initial?.vin ?? ""} helperText="Shown only to you and iTrader admins." />
        <Input name="motStatus" label="MOT or test status" defaultValue={initial?.motStatus ?? ""} />
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
        Disclosed defects
        <textarea name="disclosedDefects" required defaultValue={initial?.disclosedDefects} className={tradeFieldClass} rows={4} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
        Service history
        <textarea name="serviceHistory" defaultValue={initial?.serviceHistory ?? ""} className={tradeFieldClass} rows={3} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-text-primary">
        Notes
        <textarea name="notes" defaultValue={initial?.notes ?? ""} className={tradeFieldClass} rows={3} />
      </label>
      <Input name="availabilityNote" label="Availability" defaultValue={initial?.availabilityNote ?? ""} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text-primary">Declarations</legend>
        {[
          ["ownershipDeclared", "I own this vehicle or I am authorised to sell it."],
          ["authorityDeclared", "I am authorised to advertise it to other traders."],
          ["mileageDeclared", "The mileage is accurate to the best of my knowledge."],
          ["conditionDeclared", "I have disclosed the condition and known defects."],
          ["notWrittenOffDeclared", "This vehicle is not a written-off vehicle. Written-off vehicles are not allowed."],
        ].map(([name, label]) => (
          <label key={name} className="flex items-start gap-2 text-sm text-text-primary">
            <input type="checkbox" name={name} defaultChecked={Boolean(initial?.[name as keyof TradeListingFormValues])} className="mt-1" />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </TradeForm>
  );
}
