"use client";

import { useEffect, useState } from "react";

const LAUNCH_TIME = Date.parse("2026-10-03T10:00:00+01:00");
const UNITS = ["Days", "Hours", "Minutes", "Seconds"];

function remainingSeconds() {
  return Math.max(0, Math.ceil((LAUNCH_TIME - Date.now()) / 1000));
}

export function LaunchCountdown() {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setRemaining(remainingSeconds());
    // The server and first client render share placeholders, avoiding hydration drift.
    const initialUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, []);

  const values = remaining === null ? null : [
    Math.floor(remaining / 86400),
    Math.floor((remaining % 86400) / 3600),
    Math.floor((remaining % 3600) / 60),
    remaining % 60,
  ];

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
      {remaining === 0 && (
        <p role="status" className="mt-5 text-sm text-white/70">
          Launch time has arrived. Please refresh to check for access.
        </p>
      )}
    </div>
  );
}
