"use client";

import { useState } from "react";
import { contactSeller } from "@/actions/listings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  flattenZodFieldErrors,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { contactSellerSchema } from "@/lib/validations/listing";

interface Props {
  listingId: string;
}

export function ContactSellerForm({ listingId }: Props) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setIsSending(true);

    const formData = new FormData(e.currentTarget);
    const payload = {
      listingId,
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      website: String(formData.get("website") ?? ""),
    };
    const parsed = contactSellerSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(flattenZodFieldErrors(parsed.error));
      setIsSending(false);
      return;
    }

    const result = await contactSeller(parsed.data);
    setIsSending(false);

    if (result.error) {
      const split = splitActionError(result.error);
      setFieldErrors(split.fieldErrors);
      setError(split.formError);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p className="text-sm text-status-success-text">
        Your message has been sent to the seller.
      </p>
    );
  }

  const messageError = firstFieldError(fieldErrors, "message");
  const summaryMessages = uniqueErrorMessages(fieldErrors, error);

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <FormErrorSummary messages={summaryMessages} />
      <Input
        label="Your name"
        name="name"
        required
        placeholder="John Smith"
        error={firstFieldError(fieldErrors, "name")}
      />
      <Input
        label="Your email"
        name="email"
        type="email"
        required
        placeholder="john@example.com"
        autoComplete="email"
        error={firstFieldError(fieldErrors, "email")}
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor="message"
          className="text-sm font-medium text-text-primary"
        >
          Message
          <span aria-hidden="true" className="text-text-error">
            {" "}*
          </span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={4}
          placeholder="I'm interested in this item..."
          aria-invalid={messageError ? true : undefined}
          aria-describedby={messageError ? "contact-message-error" : undefined}
          className={[
            "flex w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline",
            messageError ? "border-neon-red-500" : "border-border",
          ].join(" ")}
        />
        {messageError ? (
          <p id="contact-message-error" className="text-xs text-text-error">
            {messageError}
          </p>
        ) : null}
      </div>
      <input type="hidden" name="listingId" value={listingId} />
      <input
        type="text"
        name="website"
        autoComplete="off"
        tabIndex={-1}
        className="hidden"
      />
      <Button type="submit" className="w-full">
        {isSending ? "Sending..." : "Send Message"}
      </Button>
    </form>
  );
}
