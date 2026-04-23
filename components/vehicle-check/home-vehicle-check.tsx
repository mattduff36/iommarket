"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatRegistrationForDisplay, getRegistrationRegion } from "@/lib/utils/registration";
import { CarFront, History, ShieldCheck } from "lucide-react";

function HomeVehicleCheckCountryBadge({ region }: { region: "iom" | "uk" }) {
  if (region === "iom") {
    return (
      <div className="flex h-full w-[76px] shrink-0 flex-col items-center justify-between border-r-2 border-black/45 bg-[linear-gradient(180deg,#bf2638_0%,#8d1023_100%)] px-2 py-1.5 text-[#ffd84d] shadow-[inset_-1px_0_0_rgba(255,255,255,0.18)]">
        <div className="relative mt-0.5 h-5 w-5 rounded-full border border-[#ffd84d]/85">
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffd84d]" />
          <span className="absolute left-[3px] top-[3px] h-1 w-1 rounded-full bg-[#ffd84d]" />
          <span className="absolute right-[3px] top-[3px] h-1 w-1 rounded-full bg-[#ffd84d]" />
          <span className="absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#ffd84d]" />
        </div>
        <span className="text-[18px] font-black uppercase leading-none tracking-[0.08em]">GBM</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[76px] shrink-0 flex-col items-center justify-between border-r-2 border-black/45 bg-[linear-gradient(180deg,#1846b4_0%,#14348b_100%)] px-2 py-1.5 text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.18)]">
      <div className="relative mt-0.5 h-4 w-5 overflow-hidden rounded-[2px] border border-white/75 bg-[#123ea0]">
        <span className="absolute inset-y-0 left-[38%] w-[24%] bg-white" />
        <span className="absolute inset-x-0 top-[38%] h-[24%] bg-white" />
        <span className="absolute inset-y-0 left-[43%] w-[14%] bg-[#c61f32]" />
        <span className="absolute inset-x-0 top-[43%] h-[14%] bg-[#c61f32]" />
      </div>
      <span className="text-[18px] font-black uppercase leading-none tracking-[0.08em]">UK</span>
    </div>
  );
}

const VEHICLE_CHECK_FEATURES = [
  {
    icon: ShieldCheck,
    iconClassName: "text-neon-blue-400",
    label: "Tax status",
  },
  {
    icon: History,
    iconClassName: "text-neon-red-400",
    label: "MOT timeline",
  },
  {
    icon: CarFront,
    iconClassName: "text-premium-gold-400",
    label: "Mileage signals",
  },
] as const;

function formatRegistrationAsTyped(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);

  if (!normalized) {
    return "";
  }

  return formatRegistrationForDisplay(normalized);
}

export function HomeVehicleCheck() {
  const router = useRouter();
  const [registration, setRegistration] = useState("");
  const [error, setError] = useState<string | null>(null);

  const registrationRegion = getRegistrationRegion(registration);
  const hasRecognizedRegion = registrationRegion !== "unrecognized";
  const inputId = "home-vehicle-check-registration";
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

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
            {VEHICLE_CHECK_FEATURES.map((feature) => {
              const Icon = feature.icon;

              return (
                <div
                  key={feature.label}
                  className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  <Icon className={`h-4 w-4 ${feature.iconClassName}`} />
                  <p className="mt-2 text-xs font-semibold text-text-primary">{feature.label}</p>
                </div>
              );
            })}
          </div>
        </div>

        <Card className="overflow-hidden rounded-[28px] border-white/10 bg-[linear-gradient(180deg,rgba(8,10,14,0.92),rgba(17,11,15,0.84))] shadow-[0_26px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <CardContent className="p-5 sm:p-6">
            <div className="space-y-5">
              <div className="border-b border-white/8 pb-4">
                <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                  Lookup console
                </p>
                <h3 className="mt-2 text-xl font-bold text-text-primary">Check any plate</h3>
                <p className="mt-2 text-sm leading-6 text-metallic-400">
                  Enter a UK or Isle of Man registration to run a live vehicle history check.
                </p>
              </div>

              <form className="space-y-3" onSubmit={handleSubmit}>
                <div className="space-y-2.5">
                  <label
                    htmlFor={inputId}
                    className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-metallic-300"
                  >
                    Registration number
                  </label>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="w-full max-w-[360px] rounded-[22px] bg-[linear-gradient(180deg,#f8e57c_0%,#e6bf17_100%)] p-[3px] shadow-[0_12px_30px_rgba(0,0,0,0.26)]">
                      <div className="relative h-16 overflow-hidden rounded-[20px] border-2 border-black/55 bg-[linear-gradient(180deg,#f9dd40_0%,#efc500_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-6px_10px_rgba(0,0,0,0.12)]">
                        {registrationRegion === "iom" || registrationRegion === "uk" ? (
                          <div className="absolute inset-y-0 left-0 flex w-[76px] items-stretch">
                            <HomeVehicleCheckCountryBadge region={registrationRegion} />
                          </div>
                        ) : (
                          <span className="pointer-events-none absolute inset-y-0 left-[76px] w-px bg-black/30 shadow-[1px_0_0_rgba(255,255,255,0.08)]" />
                        )}
                        <div className="absolute inset-y-0 left-[76px] right-0">
                          <input
                            id={inputId}
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            maxLength={9}
                            value={registration}
                            onChange={(event) => {
                              setRegistration(formatRegistrationAsTyped(event.target.value));
                              setError(null);
                            }}
                            onBlur={() => {
                              if (!registration.trim()) return;
                              setRegistration(formatRegistrationForDisplay(registration));
                            }}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? `${helperId} ${errorId}` : helperId}
                            data-country-badge={hasRecognizedRegion ? registrationRegion : "none"}
                            spellCheck={false}
                            className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent opacity-0 focus:outline-none"
                          />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 sm:px-5">
                            <span
                              className={`block select-none text-center text-lg font-black uppercase tracking-[0.28em] sm:text-[28px] ${
                                registration.trim() ? "text-black" : "text-black/40"
                              }`}
                            >
                              {registration.trim() || "REG 123"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      variant="energy"
                      size="lg"
                      className="w-full sm:ml-2 sm:w-auto sm:min-w-[120px]"
                    >
                      Search
                    </Button>
                  </div>
                </div>

                <p id={helperId} className="text-xs leading-5 text-metallic-400">
                  Supports UK and Isle of Man formats.
                </p>
                {error ? (
                  <p id={errorId} className="text-xs text-text-energy">
                    {error}
                  </p>
                ) : null}
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
