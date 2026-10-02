"use client";

import { useEffect, useState } from "react";
import { HeadlightsReveal } from "@/components/launch/headlights-reveal";
import { hasSeenLaunch, markSeenLaunch } from "@/lib/launch/launch-seen";
import { previewWelcomeEndsAt } from "@/lib/launch/preview-welcome";

export function PreviewArrival({ opensAt }: { opensAt: number }) {
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const now = Date.now();
    if (now < opensAt || now >= previewWelcomeEndsAt(opensAt) || hasSeenLaunch(opensAt)) return;
    markSeenLaunch(opensAt);
    setPlay(true);
  }, [opensAt]);

  if (!play) return null;

  return (
    <HeadlightsReveal
      backdrop
      onDone={() => setPlay(false)}
      onSkip={() => setPlay(false)}
    />
  );
}
