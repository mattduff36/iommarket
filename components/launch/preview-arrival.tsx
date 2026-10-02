"use client";

import { useEffect, useState } from "react";
import { HeadlightsReveal } from "@/components/launch/headlights-reveal";
import { hasSeenLaunch, markSeenLaunch } from "@/lib/launch/launch-seen";
import { previewWelcomeEndsAt } from "@/lib/launch/preview-welcome";

export function PreviewArrival({
  opensAt,
  environment = "public",
}: {
  opensAt: number;
  environment?: string;
}) {
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const now = Date.now();
    if (now < opensAt || now >= previewWelcomeEndsAt(opensAt) || hasSeenLaunch(opensAt, environment)) return;
    markSeenLaunch(opensAt, environment);
    setPlay(true);
  }, [opensAt, environment]);

  if (!play) return null;

  return (
    <HeadlightsReveal
      backdrop
      onDone={() => setPlay(false)}
      onSkip={() => setPlay(false)}
    />
  );
}
