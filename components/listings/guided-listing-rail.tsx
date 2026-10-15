"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertCircle, Check, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GUIDED_LISTING_STEPS,
  guidedCardStatus,
  guidedStatusLabel,
  type GuidedListingStep,
} from "@/lib/listings/guided-listing-workflow";
import styles from "./guided-listing-rail.module.css";

const STATUS_ICON = {
  current: Circle,
  complete: Check,
  attention: AlertCircle,
  pending: Circle,
} as const;

function syncActionOffset(root: HTMLElement) {
  const banner = [...document.querySelectorAll("div.fixed.z-50")].find((node) =>
    node.textContent?.includes("essential cookies"),
  );
  const offset = banner
    ? Math.max(0, window.innerHeight - banner.getBoundingClientRect().top + 8)
    : 0;
  root.style.setProperty("--listing-action-bottom", `${offset}px`);
}

export function GuidedListingRail({
  current,
  completion,
  attention,
  onSelect,
  actions,
  children,
}: {
  current: GuidedListingStep;
  completion: Record<GuidedListingStep, boolean>;
  attention: Record<GuidedListingStep, boolean>;
  onSelect: (step: GuidedListingStep) => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => syncActionOffset(root);
    sync();
    const frame = window.requestAnimationFrame(sync);
    const banner = [...document.querySelectorAll("div.fixed.z-50")].find((node) =>
      node.textContent?.includes("essential cookies"),
    );
    const observer = banner ? new ResizeObserver(sync) : null;
    if (banner) observer?.observe(banner);
    window.addEventListener("resize", sync);
    window.addEventListener("itrader:cookie-consent-changed", sync);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("itrader:cookie-consent-changed", sync);
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.workflow}>
      <div className={styles.rail} role="group" aria-label="Listing steps">
        {GUIDED_LISTING_STEPS.map((entry, index) => {
          const status = guidedCardStatus({
            step: entry.step,
            current,
            complete: completion[entry.step],
            attention: attention[entry.step],
          });
          const Icon = STATUS_ICON[status];
          return (
            <div key={entry.step} className={styles.step}>
              {index > 0 ? <span aria-hidden="true" className={styles.arrow}>›</span> : <span className={styles.arrowSpacer} aria-hidden="true" />}
              <Button
                type="button"
                variant="ghost"
                id={`${panelId}-step-${entry.step}`}
                className={`${styles.card} h-auto w-full min-w-0 flex-col gap-1 whitespace-normal rounded-none px-0 py-2 text-[11px] font-semibold normal-case not-italic`}
                data-state={status}
                aria-pressed={current === entry.step}
                aria-controls={panelId}
                aria-label={`${entry.description}. ${guidedStatusLabel(status)}`}
                onClick={() => onSelect(entry.step)}
              >
                <Icon aria-hidden size={18} />
                <span className={styles.label}>{entry.label}</span>
              </Button>
            </div>
          );
        })}
      </div>
      <div
        className={styles.panel}
        id={panelId}
        role="region"
        aria-live="polite"
        aria-labelledby={`${panelId}-step-${current}`}
      >
        <div className={styles.scroller}>{children}</div>
        <div className={styles.actions}>{actions}</div>
      </div>
    </div>
  );
}
