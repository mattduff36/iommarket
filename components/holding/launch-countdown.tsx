"use client";

import { useEffect, useState } from "react";
import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";

const UNITS = ["Days", "Hours", "Minutes", "Seconds"];

function releaseStorageKey(opensAt: number) {
  return `itrader-preview-launch-release:${opensAt}`;
}
const RELEASE_MAX_ATTEMPTS = 12;
const RELEASE_RETRY_MS = 5000;

export const launchRelease = {
  reload() {
    window.location.reload();
  },
};

function remainingSeconds(opensAt: number) {
  return Math.max(0, Math.ceil((opensAt - Date.now()) / 1000));
}

function releaseAttempts(opensAt: number): number {
  try {
    const stored = Number(window.sessionStorage.getItem(releaseStorageKey(opensAt)) ?? "0");
    return Number.isFinite(stored) ? stored : RELEASE_MAX_ATTEMPTS;
  } catch {
    return RELEASE_MAX_ATTEMPTS;
  }
}

function rememberReleaseAttempt(opensAt: number, attempt: number) {
  try {
    window.sessionStorage.setItem(releaseStorageKey(opensAt), String(attempt));
  } catch {
    // A blocked storage API must not reload the holding page in a loop.
  }
}

export function LaunchCountdown({
  opensAt = PUBLIC_LAUNCH_AT,
  releaseOnZero = false,
}: {
  opensAt?: number;
  releaseOnZero?: boolean;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [releaseExhausted, setReleaseExhausted] = useState(false);

  useEffect(() => {
    const update = () => setRemaining(remainingSeconds(opensAt));
    // The server and first client render share placeholders, avoiding hydration drift.
    const initialUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, [opensAt]);

  useEffect(() => {
    if (!releaseOnZero || remaining !== 0) return;
    const attempts = releaseAttempts(opensAt);
    if (attempts >= RELEASE_MAX_ATTEMPTS) {
      setReleaseExhausted(true);
      return;
    }
    const timeout = window.setTimeout(() => {
      rememberReleaseAttempt(opensAt, attempts + 1);
      launchRelease.reload();
    }, attempts === 0 ? 0 : RELEASE_RETRY_MS);
    return () => window.clearTimeout(timeout);
  }, [opensAt, releaseOnZero, remaining]);

  const values = remaining === null ? null : [
    Math.floor(remaining / 86400),
    Math.floor((remaining % 86400) / 3600),
    Math.floor((remaining % 3600) / 60),
    remaining % 60,
  ];
  const showRefreshMessage = remaining === 0 && (!releaseOnZero || releaseExhausted);

  return (
    <div className="my-6 w-full max-w-[425px] text-center">
      <div role="timer" aria-label="Time until iTrader launches" aria-live="off" className="mx-auto grid w-full grid-cols-4 gap-2 sm:gap-3">
        {UNITS.map((unit, index) => (
          <div key={unit} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-4 sm:py-5">
            <span className="block font-heading text-[28px] font-bold leading-tight tabular-nums text-white sm:text-[40px]">
              {values ? String(values[index]).padStart(2, "0") : "--"}
            </span>
            <span className="mt-2 block text-[9px] uppercase tracking-[0.15em] text-white/60 sm:text-[10px] sm:tracking-[0.2em]">{unit}</span>
          </div>
        ))}
      </div>
      {remaining === 0 && releaseOnZero && !releaseExhausted && (
        <p role="status" className="mt-5 text-sm text-white/70">
          Opening the site…
        </p>
      )}
      {showRefreshMessage && (
        <p role="status" className="mt-5 text-sm text-white/70">
          Launch time has arrived. Please refresh to check for access.
        </p>
      )}
    </div>
  );
}
