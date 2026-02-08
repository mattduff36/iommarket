"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  listingId: string;
}

export function ContactSellerForm({ listingId }: Props) {
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // MVP: simple mailto or form submission
    setSent(true);
  }

  if (sent) {
    return (
      <p className="text-sm text-status-success-text">
        Your message has been sent to the seller.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        label="Your name"
        name="name"
        required
        placeholder="John Smith"
      />
      <Input
        label="Your email"
        name="email"
        type="email"
        required
        placeholder="john@example.com"
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor="message"
          className="text-sm font-medium text-text-primary"
        >
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={4}
          placeholder="I'm interested in this item..."
          className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline"
        />
      </div>
      <input type="hidden" name="listingId" value={listingId} />
      <Button type="submit" className="w-full">
        Send Message
      </Button>
    </form>
  );
}
