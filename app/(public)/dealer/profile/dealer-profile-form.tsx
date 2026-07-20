"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMyDealerProfile } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealerLogoUpload } from "./dealer-logo-upload";

interface Props {
  initialData: {
    name: string;
    slug: string;
    bio: string | null;
    website: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
}

export function DealerProfileForm({ initialData }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(initialData.name);
  const [slug, setSlug] = useState(initialData.slug);
  const [bio, setBio] = useState(initialData.bio ?? "");
  const [website, setWebsite] = useState(initialData.website ?? "");
  const [phone, setPhone] = useState(initialData.phone ?? "");
  const [logoUrl, setLogoUrl] = useState(initialData.logoUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function parseError(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const fields = Object.values(value as Record<string, unknown>)
        .flatMap((item) => (Array.isArray(item) ? item : []))
        .filter((item): item is string => typeof item === "string");
      if (fields.length > 0) return fields[0];
    }
    return "Failed to update dealer profile.";
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await updateMyDealerProfile({
        name,
        slug,
        bio,
        website,
        phone,
      });

      if (result.error) {
        setError(parseError(result.error));
        return;
      }

      setSuccess("Dealer profile updated.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <DealerLogoUpload
            dealerName={name}
            logoUrl={logoUrl || null}
            onLogoChange={(nextLogoUrl) => {
              setLogoUrl(nextLogoUrl ?? "");
              setError(null);
            }}
          />
          <div>
            <CardTitle>Dealer Profile Details</CardTitle>
            <p className="mt-1 text-sm text-text-secondary">
              Your logo appears on your public profile and dealer listings.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Dealer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={100}
          />

          <Input
            label="Public profile slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
            minLength={2}
            maxLength={100}
          />

          <Input
            label="Website (optional)"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://..."
            maxLength={500}
          />

          <Input
            label="Phone (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
          />

          <div className="flex flex-col gap-1">
            <label htmlFor="dealer-bio" className="text-sm font-medium text-text-primary">
              Bio (optional)
            </label>
            <textarea
              id="dealer-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={5}
              maxLength={2000}
              className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline"
            />
          </div>

          {error ? <p className="text-sm text-text-error">{error}</p> : null}
          {success ? <p className="text-sm text-neon-blue-400">{success}</p> : null}

          <div className="space-y-2">
            <Button type="submit" loading={isPending}>
              Save Dealer Profile
            </Button>
            <p
              id="dealer-logo-guidance"
              className="text-xs leading-5 text-text-secondary md:whitespace-nowrap"
            >
              * Dealer logos should be in PNG, JPG, GIF, or WebP format. Square images work
              best. Maximum 5 MB.
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
