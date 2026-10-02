"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HeadlightsReveal } from "@/components/launch/headlights-reveal";
import { launchRelease } from "@/components/holding/launch-countdown";
import { hasSeenLaunch, markSeenLaunch } from "@/lib/launch/launch-seen";
import { previewWelcomeEndsAt, shouldAnimateCountdownFlight } from "@/lib/launch/preview-welcome";
import styles from "./preview-holding-launch.module.css";

const UNITS = ["Days", "Hours", "Minutes", "Seconds"] as const;
const RELEASE_MAX_ATTEMPTS = 12;
const RELEASE_RETRY_MS = 5000;

function releaseKey(opensAt: number) {
  return `itrader-preview-launch-release:${opensAt}`;
}

function releaseAttempts(opensAt: number) {
  try {
    const stored = Number(window.sessionStorage.getItem(releaseKey(opensAt)) ?? "0");
    return Number.isFinite(stored) ? stored : RELEASE_MAX_ATTEMPTS;
  } catch {
    return RELEASE_MAX_ATTEMPTS;
  }
}

function centerTransform(from: DOMRect) {
  const viewport = window.visualViewport;
  const width = viewport ? viewport.width : window.innerWidth;
  const height = viewport ? viewport.height : window.innerHeight;
  const offsetLeft = viewport ? viewport.offsetLeft : 0;
  const offsetTop = viewport ? viewport.offsetTop : 0;
  const availableTop = offsetTop + 20;
  const availableBottom = offsetTop + height - 16;
  const maxH = Math.max(72, availableBottom - availableTop);
  const maxW = Math.max(72, width - 24);
  const target = Math.min(width * 0.62, maxH, 280);
  const scale = Math.min(
    maxW / Math.max(from.width, 1),
    maxH / Math.max(from.height, 1),
    Math.max(1, target / Math.max(from.width, from.height, 1)),
  );
  const scaledW = from.width * scale;
  const scaledH = from.height * scale;
  const left = offsetLeft + (width - scaledW) / 2;
  const top = Math.max(availableTop, Math.min(offsetTop + (height - scaledH) / 2, availableBottom - scaledH));
  return `translate(${left - from.left}px, ${top - from.top}px) scale(${scale})`;
}

export function PreviewHoldingLaunch({ opensAt }: { opensAt: number }) {
  const secondsRef = useRef<HTMLDivElement>(null);
  const focusCardRef = useRef<HTMLDivElement>(null);
  const focusDigitsRef = useRef<HTMLSpanElement>(null);
  const wasAboveTen = useRef(true);
  const flightPlayed = useRef(false);
  const releaseStarted = useRef(false);
  const pulsedSecond = useRef(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [reveal, setReveal] = useState(false);
  const [snap, setSnap] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    let frame = 0;
    const step = () => {
      const left = opensAt - Date.now();
      if (left <= 0) {
        setSecondsLeft(0);
        if (!releaseStarted.current) {
          releaseStarted.current = true;
          const expired = Date.now() >= previewWelcomeEndsAt(opensAt) || hasSeenLaunch(opensAt);
          if (expired) {
            const attempts = releaseAttempts(opensAt);
            if (attempts >= RELEASE_MAX_ATTEMPTS) setExhausted(true);
            else {
              window.setTimeout(() => {
                try {
                  window.sessionStorage.setItem(releaseKey(opensAt), String(attempts + 1));
                } catch {
                  // The attempt still proceeds so the holding page cannot loop forever.
                }
                launchRelease.reload();
              }, attempts === 0 ? 0 : RELEASE_RETRY_MS);
            }
          } else {
            markSeenLaunch(opensAt);
            setReveal(true);
          }
        }
        return;
      }
      const seconds = Math.ceil(left / 1000);
      if (seconds > 10) wasAboveTen.current = true;
      setSecondsLeft((current) => (current === seconds ? current : seconds));
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    const onVisible = () => {
      if (document.visibilityState !== "visible" || releaseStarted.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(step);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [opensAt]);

  const focusing = secondsLeft !== null && secondsLeft <= 10 && secondsLeft > 0;

  useEffect(() => {
    return () => {
      const page = document.querySelector("[data-holding-page]");
      page?.classList.remove(styles.dim, styles.snapDim);
      page?.removeAttribute("inert");
    };
  }, []);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 10) return;
    const page = document.querySelector("[data-holding-page]");
    if (!page || page.classList.contains(styles.dim)) return;
    const animate = shouldAnimateCountdownFlight(opensAt - Date.now(), wasAboveTen.current, reducedMotion());
    page.classList.add(styles.dim);
    if (!animate) page.classList.add(styles.snapDim);
    page.setAttribute("inert", "");
  }, [opensAt, secondsLeft]);

  useEffect(() => {
    if (!focusing || flightPlayed.current) return;
    const source = secondsRef.current;
    const card = focusCardRef.current;
    const digits = focusDigitsRef.current;
    if (!source || !card || !digits) return;
    const from = source.getBoundingClientRect();
    const sourceDigit = source.querySelector("span");
    if (sourceDigit) digits.style.fontSize = getComputedStyle(sourceDigit).fontSize;
    card.style.left = `${from.left}px`;
    card.style.top = `${from.top}px`;
    card.style.width = `${from.width}px`;
    card.style.height = `${from.height}px`;
    const next = centerTransform(from);
    const animate = shouldAnimateCountdownFlight(opensAt - Date.now(), wasAboveTen.current, reducedMotion());
    card.style.transition = "none";
    card.style.transform = "translate(0px, 0px) scale(1)";
    if (!animate) {
      wasAboveTen.current = false;
      flightPlayed.current = true;
      setSnap(true);
      card.style.transform = next;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      wasAboveTen.current = false;
      flightPlayed.current = true;
      card.style.transition = "transform 1.25s cubic-bezier(0.16, 1, 0.3, 1)";
      card.style.transform = next;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusing, opensAt]);

  useEffect(() => {
    if (reducedMotion() || secondsLeft === null || secondsLeft > 3 || secondsLeft < 1 || secondsLeft === pulsedSecond.current) return;
    const digits = focusDigitsRef.current;
    if (!digits) return;
    pulsedSecond.current = secondsLeft;
    digits.classList.remove(styles.pulse);
    void digits.offsetWidth;
    digits.classList.add(styles.pulse);
  }, [secondsLeft]);

  const values = secondsLeft === null ? null : [
    Math.floor(secondsLeft / 86400),
    Math.floor((secondsLeft % 86400) / 3600),
    Math.floor((secondsLeft % 3600) / 60),
    secondsLeft % 60,
  ];
  const secondLabel = values ? String(values[3]).padStart(2, "0") : "--";
  const red = secondsLeft !== null && secondsLeft <= 5 && secondsLeft > 0;

  const finished = useRef(false);
  function finish() {
    if (finished.current) return;
    finished.current = true;
    launchRelease.reload();
  }

  return (
    <>
      <div className={`${styles.timer} ${snap ? styles.snap : ""}`} role="timer" aria-label="Time until iTrader launches" aria-live="off">
        {UNITS.map((unit, index) => {
          const isSeconds = unit === "Seconds";
          return (
            <div
              key={unit}
              ref={isSeconds ? secondsRef : undefined}
              className={`${styles.card} ${!isSeconds && focusing ? styles.fade : ""} ${isSeconds && (focusing || reveal) ? styles.hiddenSource : ""}`}
            >
              <span className={styles.digit}>{values ? String(values[index]).padStart(2, "0") : "--"}</span>
              <span className={styles.unit}>{unit}</span>
            </div>
          );
        })}
      </div>
      {exhausted && (
        <p role="status" className={styles.status}>Launch time has arrived. Please refresh to check for access.</p>
      )}
      {(focusing || reveal) && createPortal(
        <div className={`${styles.focus} ${reveal ? styles.handoff : ""}`}>
          <div ref={focusCardRef} className={`${styles.focusCard} ${styles.large} ${red ? styles.red : ""}`} aria-hidden="true">
            <span ref={focusDigitsRef} className={styles.focusDigit}>{secondLabel}</span>
            <span className={styles.focusUnit}>Seconds</span>
          </div>
        </div>,
        document.body,
      )}
      {reveal && <HeadlightsReveal onDone={finish} onSkip={finish} />}
    </>
  );
}

function reducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
