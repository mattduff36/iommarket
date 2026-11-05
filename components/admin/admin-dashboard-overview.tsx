"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import styles from "./admin-dashboard-overview.module.css";

type AdminDashboardOverviewProps = {
  children: ReactNode;
  trade?: ReactNode;
};

type Panel = "marketplace" | "trade";
type Phase = "idle" | "clearing" | "sliding" | "revealing";
type PanelTransition = { active: Panel; target: Panel; phase: Phase };

const CLEAR_MS = 130;
const SLIDE_MS = 420;
const REVEAL_MS = 180;

export function AdminDashboardOverview({ children, trade }: AdminDashboardOverviewProps) {
  const [transition, setTransition] = useState<PanelTransition>({
    active: "marketplace", target: "marketplace", phase: "idle",
  });
  const { active, phase } = transition;
  const id = useId();
  const hasTrade = trade !== undefined && trade !== null && trade !== false;

  useEffect(() => {
    if (phase === "idle") return;
    // transitionend normally completes the slide; the extra frame budget is a
    // fallback for a hidden tab or a browser that does not emit that event.
    const duration = phase === "clearing" ? CLEAR_MS : phase === "sliding" ? SLIDE_MS + 80 : REVEAL_MS;
    const timer = window.setTimeout(() => {
      setTransition((current) => {
        if (current.phase !== phase) return current;
        if (phase === "clearing") return { ...current, active: current.target, phase: "sliding" };
        return { ...current, phase: phase === "sliding" ? "revealing" : "idle" };
      });
    }, duration);
    return () => window.clearTimeout(timer);
  }, [phase]);

  function openPanel(panel: Panel) {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setTransition((current) => {
      if (current.phase !== "idle" || current.active === panel) return current;
      return reducedMotion
        ? { active: panel, target: panel, phase: "idle" }
        : { ...current, target: panel, phase: "clearing" };
    });
  }

  return (
    <div
      className={styles.overview}
      data-active={active}
      data-trade={hasTrade}
      data-phase={phase}
      aria-busy={phase !== "idle"}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-columns") {
          setTransition((current) => current.phase === "sliding" ? { ...current, phase: "revealing" } : current);
        }
      }}
    >
      {(["marketplace", ...(hasTrade ? ["trade" as const] : [])] as const).map((panel) => {
        const expanded = !hasTrade || active === panel;
        const contentVisible = expanded && (phase === "idle" || phase === "revealing");
        const title = panel === "marketplace" ? "Marketplace" : "Trade Exchange";
        const buttonId = `${id}-${panel}-heading`;
        const contentId = `${id}-${panel}-content`;

        return (
          <section key={panel} className={styles.panel} data-panel={panel} data-expanded={expanded}>
            <h3 className={styles.heading} id={hasTrade ? undefined : buttonId}>
              {hasTrade ? (
                <button
                  type="button"
                  id={buttonId}
                  className={styles.toggle}
                  aria-label={title}
                  aria-expanded={expanded}
                  aria-disabled={phase !== "idle"}
                  aria-controls={contentId}
                  onClick={() => openPanel(panel)}
                >
                  <span className={styles.label}>{title}</span>
                  <span className={styles.rail} aria-hidden="true">
                    <span className={styles.railLabel}>{title}</span>
                    {panel === "marketplace" ? (
                      <ArrowRight className={styles.arrow} aria-hidden="true" />
                    ) : (
                      <ArrowLeft className={styles.arrow} aria-hidden="true" />
                    )}
                  </span>
                </button>
              ) : title}
            </h3>
            <div
              id={contentId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!contentVisible}
              inert={!contentVisible}
              className={styles.content}
            >
              {panel === "marketplace" ? children : trade}
            </div>
          </section>
        );
      })}
    </div>
  );
}
