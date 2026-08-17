import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { LISTING_DECLARATION_LABEL } from "@/lib/listings/write-off-category";

export function CreateListingDeclarations({
  mode,
  step,
  trustConfirmed,
  trustConfirmationMissing,
  privateSellerTermsAccepted,
  privateSellerTermsMissing,
  onTrustChange,
  onPrivateTermsChange,
}: {
  mode: "private" | "dealer";
  step: number;
  trustConfirmed: boolean;
  trustConfirmationMissing: boolean;
  privateSellerTermsAccepted: boolean;
  privateSellerTermsMissing: boolean;
  onTrustChange: (accepted: boolean) => void;
  onPrivateTermsChange: (accepted: boolean) => void;
}) {
  return (
    <>
      <p
        className={`text-sm ${
          trustConfirmationMissing ? "text-text-energy" : "text-text-secondary"
        }`}
      >
        Please confirm ownership or authority, accuracy, photo rights,
        prohibited-vehicle rules, Category N/S disclosure, and that the
        vehicle is not stolen and has no outstanding finance.
      </p>
      <Checkbox
        checked={trustConfirmed}
        onCheckedChange={(checked) => onTrustChange(checked === true)}
        className="h-5 w-5 border-2 border-white/70 bg-surface-elevated"
        label={LISTING_DECLARATION_LABEL}
      />
      {mode === "private" ? (
        <div
          className={
            privateSellerTermsMissing
              ? "rounded-md border border-neon-red-500 p-3"
              : "rounded-md border border-border p-3"
          }
        >
          <Checkbox
            checked={privateSellerTermsAccepted}
            onCheckedChange={(checked) => onPrivateTermsChange(checked === true)}
            required={step === 3}
            label={
              <span className="leading-5">
                I expressly accept the current{" "}
                <Link
                  href="/private-seller-terms"
                  target="_blank"
                  className="text-neon-blue-400 underline"
                >
                  Private Seller Terms
                </Link>
                ,{" "}
                <Link
                  href="/acceptable-use"
                  target="_blank"
                  className="text-neon-blue-400 underline"
                >
                  Acceptable Use Policy
                </Link>
                , and{" "}
                <Link
                  href="/refunds"
                  target="_blank"
                  className="text-neon-blue-400 underline"
                >
                  Refund Policy
                </Link>
                .
              </span>
            }
          />
          {privateSellerTermsMissing ? (
            <p className="mt-2 text-xs text-text-error">
              Accept the current private seller policies before
              continuing.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
