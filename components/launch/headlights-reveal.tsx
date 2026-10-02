"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";
import { PREVIEW_REVEAL_MS } from "@/lib/launch/preview-welcome";
import styles from "./headlights-reveal.module.css";

export function HeadlightsReveal({
  onDone,
  onSkip,
  backdrop = false,
}: {
  onDone: () => void;
  onSkip: () => void;
  backdrop?: boolean;
}) {
  const doneRef = useRef(onDone);
  const skipRef = useRef(onSkip);
  doneRef.current = onDone;
  skipRef.current = onSkip;
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setMounted(true);
    setReduced(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const timer = window.setTimeout(() => doneRef.current(), PREVIEW_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={reduced ? styles.stage : `${styles.stage} ${styles.playing}`}
      style={backdrop ? { background: HERO_GRADIENT } : undefined}
      role="dialog"
      aria-label="Welcome"
    >
      <p className={styles.srOnly} aria-live="polite">Welcome</p>
      <div className={`${styles.beam} ${styles.red}`} aria-hidden="true" />
      <div className={`${styles.beam} ${styles.blue}`} aria-hidden="true" />
      <div className={styles.pool} aria-hidden="true" />
      <div className={styles.lockup}>
        <Image
          src="/images/logo-itrader-hq.png"
          alt="iTrader.im – Buy · Sell · Upgrade"
          width={620}
          height={200}
          priority
          className={styles.logo}
          onError={() => doneRef.current()}
        />
        <p className={styles.shout}>Welcome</p>
      </div>
      <button type="button" className={styles.skip} autoFocus onClick={() => skipRef.current()}>
        Skip animation
      </button>
    </div>,
    document.body,
  );
}
