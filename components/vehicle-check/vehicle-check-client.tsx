"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { openVehicleCheckPrintWindow } from "@/components/vehicle-check/vehicle-check-print";
import { VehicleCheckResultPanel } from "@/components/vehicle-check/vehicle-check-result-panel";
import type { VehicleCheckResponse, VehicleCheckResult } from "@/lib/services/vehicle-check-types";
import {
  formatRegistrationForDisplay,
  isManxRegistration,
} from "@/lib/utils/registration";
import {
  CarFront,
  Gauge,
  History,
  ReceiptPoundSterling,
  Search,
  ShieldCheck,
} from "lucide-react";

interface VehicleCheckClientProps {
  initialRegistration?: string;
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Vehicle lookup failed";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object") {
    const firstValue = Object.values(record.error)[0];
    if (typeof firstValue === "string") {
      return firstValue;
    }
    if (Array.isArray(firstValue) && typeof firstValue[0] === "string") {
      return firstValue[0];
    }
  }

  return "Vehicle lookup failed";
}

function LoadingPanel() {
  return (
    <Card className="border-neon-blue-500/25 bg-surface/85">
      <CardContent className="space-y-6 p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-neon-blue-400">
            Running live checks
          </p>
          <h2 className="mt-2 text-2xl font-bold text-text-primary">
            Searching tax, MOT, gov.im, and auction sources
          </h2>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-canvas">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-neon-blue-500" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      </CardContent>
    </Card>
  );
}

export function VehicleCheckClient({
  initialRegistration,
}: VehicleCheckClientProps) {
  const router = useRouter();
  const [registration, setRegistration] = useState(
    initialRegistration ? formatRegistrationForDisplay(initialRegistration) : ""
  );
  const [result, setResult] = useState<VehicleCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const autoLookupTriggeredRef = useRef(false);

  const updateUrl = useCallback(
    (nextRegistration: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (nextRegistration) {
        params.set("reg", nextRegistration);
      } else {
        params.delete("reg");
      }

      const query = params.toString();
      router.replace(query ? `/vehicle-check?${query}` : "/vehicle-check", {
        scroll: false,
      });
    },
    [router]
  );

  const runLookup = useCallback(
    async (submittedRegistration: string, syncUrl = true) => {
      const trimmed = submittedRegistration.trim();
      if (!trimmed) {
        setError("Enter a UK or Isle of Man registration");
        setResult(null);
        if (syncUrl) updateUrl(null);
        return;
      }

      const prettyRegistration = formatRegistrationForDisplay(trimmed);
      setRegistration(prettyRegistration);
      setError(null);
      if (syncUrl) updateUrl(trimmed);

      try {
        const response = await fetch("/api/vehicle-check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ registration: trimmed }),
        });

        const payload = (await response.json().catch(() => null)) as
          | VehicleCheckResponse
          | null;

        if (!response.ok || !payload?.success) {
          setResult(null);
          setError(extractErrorMessage(payload));
          return;
        }

        setResult(payload.result);
      } catch {
        setResult(null);
        setError("Vehicle lookup failed. Please try again.");
      }
    },
    [updateUrl]
  );

  useEffect(() => {
    if (!initialRegistration || autoLookupTriggeredRef.current) {
      return;
    }

    autoLookupTriggeredRef.current = true;
    startTransition(() => {
      void runLookup(initialRegistration, false);
    });
  }, [initialRegistration, runLookup]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(() => {
      void runLookup(registration, true);
    });
  };

  const handleClear = () => {
    setRegistration("");
    setResult(null);
    setError(null);
    updateUrl(null);
  };

  const inputBadgeLabel = isManxRegistration(registration) ? "M" : "GB";
  const hasLookup = Boolean(result || error || isPending);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[28px] border border-neon-blue-500/25 bg-[radial-gradient(circle_at_top_left,rgba(51,181,255,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,59,92,0.16),transparent_24%),linear-gradient(145deg,rgba(11,16,21,0.98),rgba(16,21,28,0.96))]">
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <Badge variant="trust" className="px-3 py-1 text-[11px] tracking-[0.18em]">
                PUBLIC VEHICLE CHECK
              </Badge>
              <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-text-primary sm:text-5xl">
                Tax and MOT intelligence for UK and Manx registrations.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-metallic-300 sm:text-lg">
                Run a live check against DVLA, MOT history, gov.im, and external
                auction references, then export a clean report in one place.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <ShieldCheck className="h-5 w-5 text-neon-blue-400" />
                  <p className="mt-3 text-sm font-semibold text-text-primary">
                    Tax status
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    Live taxed, SORN, and due-date checks.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <History className="h-5 w-5 text-neon-red-400" />
                  <p className="mt-3 text-sm font-semibold text-text-primary">
                    MOT timeline
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    Passes, failures, advisories, and expiry data.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <Gauge className="h-5 w-5 text-premium-gold-400" />
                  <p className="mt-3 text-sm font-semibold text-text-primary">
                    Mileage and auction context
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    Read the trend line and spot external sale references.
                  </p>
                </div>
              </div>
            </div>

            <Card className="border-white/10 bg-black/30 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
              <CardContent className="p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                      Lookup console
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-text-primary">
                      Check any plate
                    </h2>
                  </div>
                  <div className="flex h-12 w-14 items-center justify-center rounded-xl border border-white/10 bg-canvas text-lg font-bold text-text-primary">
                    {inputBadgeLabel}
                  </div>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                  <Input
                    label="Registration number"
                    value={registration}
                    onChange={(event) =>
                      setRegistration(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9 -]/g, "")
                      )
                    }
                    onBlur={() => {
                      if (!registration.trim()) return;
                      setRegistration(formatRegistrationForDisplay(registration));
                    }}
                    placeholder="e.g. AB12 CDE or MAN 123"
                    helperText="Supports UK and Isle of Man formats."
                    className="h-14 text-lg font-semibold tracking-[0.12em]"
                  />

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full sm:flex-1"
                      loading={isPending}
                      leftIcon={<Search className="h-4 w-4" />}
                    >
                      Run live check
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="sm:w-auto"
                      onClick={handleClear}
                    >
                      Clear
                    </Button>
                  </div>
                </form>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-neon-blue-500/20 bg-neon-blue-500/6 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <ReceiptPoundSterling className="h-4 w-4 text-neon-blue-400" />
                      Tax and duty
                    </div>
                    <p className="mt-2 text-sm text-text-secondary">
                      UK DVLA tax status, due dates, plus Manx duty context where
                      available.
                    </p>
                  </div>
                  <div className="rounded-xl border border-neon-red-500/20 bg-neon-red-500/6 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <CarFront className="h-4 w-4 text-neon-red-400" />
                      Roadworthiness history
                    </div>
                    <p className="mt-2 text-sm text-text-secondary">
                      MOT status, expiry, mileage trend, and linked previous-UK
                      registration handling for Manx vehicles.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {isPending ? <LoadingPanel /> : null}

      {!isPending && error ? (
        <Card className="border-neon-red-500/25 bg-neon-red-500/6">
          <CardContent className="p-6">
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6 text-neon-red-400" />}
              title="Lookup could not be completed"
              description={error}
              className="py-6"
            />
          </CardContent>
        </Card>
      ) : null}

      {!isPending && result ? (
        <VehicleCheckResultPanel
          result={result}
          onExportPdf={() => openVehicleCheckPrintWindow(result)}
        />
      ) : null}

      {!hasLookup ? (
        <Card>
          <CardContent className="p-6 sm:p-8">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-border bg-canvas/50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                  What you get
                </p>
                <p className="mt-3 text-base font-semibold text-text-primary">
                  A single-screen vehicle dossier
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  Registration identity, tax, MOT, mileage, and any auction
                  references that match.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-canvas/50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                  UK + IoM aware
                </p>
                <p className="mt-3 text-base font-semibold text-text-primary">
                  Smart source switching
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  UK plates use DVLA and MOT sources, while Manx plates route
                  through gov.im with previous-UK MOT linkage when available.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-canvas/50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                  Ready to share
                </p>
                <p className="mt-3 text-base font-semibold text-text-primary">
                  PDF-style export included
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  Generate a clean printable report straight from the results
                  screen without exposing any API credentials to the browser.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
