"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRegistrationForDisplay, isManxRegistration } from "@/lib/utils/registration";
import { CarFront, History, Search, ShieldCheck } from "lucide-react";

export function HomeVehicleCheck() {
  const router = useRouter();
  const [registration, setRegistration] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputBadgeLabel = isManxRegistration(registration) ? "M" : "GB";

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = registration.trim();
    if (!trimmed) {
      setError("Enter a UK or Isle of Man registration");
      return;
    }

    setError(null);
    router.push(`/vehicle-check?reg=${encodeURIComponent(trimmed)}`);
  };

  const handleClear = () => {
    setRegistration("");
    setError(null);
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-neon-blue-500/20 bg-[radial-gradient(circle_at_top_left,rgba(51,181,255,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,59,92,0.12),transparent_24%),linear-gradient(145deg,rgba(11,16,21,0.98),rgba(16,21,28,0.96))]">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:p-8">
        <div>
          <Badge variant="trust" className="px-2.5 py-1 text-[10px] tracking-[0.18em]">
            VEHICLE CHECK
          </Badge>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">
            Run a quick plate check before you buy.
          </h2>
          <p className="mt-3 text-sm leading-6 text-metallic-300">
            Get tax status, MOT history, and mileage context in one report for UK and Isle of Man plates.
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <ShieldCheck className="h-4 w-4 text-neon-blue-400" />
              <p className="mt-2 text-xs font-semibold text-text-primary">Tax status</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <History className="h-4 w-4 text-neon-red-400" />
              <p className="mt-2 text-xs font-semibold text-text-primary">MOT timeline</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <CarFront className="h-4 w-4 text-premium-gold-400" />
              <p className="mt-2 text-xs font-semibold text-text-primary">Mileage signals</p>
            </div>
          </div>
        </div>

        <Card className="border-white/10 bg-black/35 backdrop-blur">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                  Lookup console
                </p>
                <h3 className="mt-2 text-xl font-bold text-text-primary">Check any plate</h3>
              </div>
              <div className="flex h-11 w-14 items-center justify-center rounded-xl border border-white/10 bg-canvas text-base font-bold text-text-primary">
                {inputBadgeLabel}
              </div>
            </div>

            <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
              <Input
                label="Registration number"
                value={registration}
                onChange={(event) =>
                  setRegistration(event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ""))
                }
                onBlur={() => {
                  if (!registration.trim()) return;
                  setRegistration(formatRegistrationForDisplay(registration));
                }}
                placeholder="e.g. AB12 CDE or MAN 123"
                helperText="Supports UK and Isle of Man formats."
                className="h-12 text-base font-semibold tracking-[0.12em]"
                error={error ?? undefined}
              />

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="submit"
                  className="w-full sm:flex-1"
                  leftIcon={<Search className="h-4 w-4" />}
                >
                  Run live check
                </Button>
                <Button type="button" variant="ghost" className="sm:w-auto" onClick={handleClear}>
                  Clear
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
