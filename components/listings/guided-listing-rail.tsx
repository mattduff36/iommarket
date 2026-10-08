"use client";

import { useId, type ReactNode } from "react";
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

export function GuidedListingRail({
  current,
  completion,
  attention,
  onSelect,
  children,
}: {
  current: GuidedListingStep;
  completion: Record<GuidedListingStep, boolean>;
  attention: Record<GuidedListingStep, boolean>;
  onSelect: (step: GuidedListingStep) => void;
  children: ReactNode;
}) {
  const panelId = useId();

  return (
    <div className={styles.workflow}>
      <div className={styles.rail} role="group" aria-label="Listing steps">
        {GUIDED_LISTING_STEPS.map((entry) => {
          const status = guidedCardStatus({
            step: entry.step,
            current,
            complete: completion[entry.step],
            attention: attention[entry.step],
          });
          const Icon = STATUS_ICON[status];
          return (
            <Button
              key={entry.step}
              type="button"
              variant="ghost"
              id={`${panelId}-step-${entry.step}`}
              className={`${styles.card} h-auto min-h-[5.75rem] w-full min-w-0 flex-col gap-1 whitespace-normal rounded-none px-1 py-2 text-[11px] font-semibold normal-case not-italic`}
              data-state={status}
              aria-pressed={current === entry.step}
              aria-expanded={current === entry.step}
              aria-controls={panelId}
              aria-label={`${entry.description}. ${guidedStatusLabel(status)}`}
              onClick={() => onSelect(entry.step)}
            >
              <Icon aria-hidden size={18} />
              <span className={styles.label}>{entry.label}</span>
              <span className={styles.state}>{guidedStatusLabel(status)}</span>
            </Button>
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
        {children}
      </div>
    </div>
  );
}