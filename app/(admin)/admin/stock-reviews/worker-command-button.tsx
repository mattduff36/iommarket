"use client";

import { LoaderCircle, Play, Square } from "lucide-react";
import { stockWorkerCommandClass, stockWorkerCommandLabel } from "./worker-context";
import styles from "./worker-progress.module.css";

export function StockWorkerCommandButton({ running, pending, pendingCommand, stopping, disabled, onClick, iconOnly = false }: {
  running: boolean; pending: boolean; pendingCommand: boolean; stopping: boolean;
  disabled: boolean; onClick: () => void; iconOnly?: boolean;
}) {
  const label = stockWorkerCommandLabel({ running, pending, pendingCommand, stopping });
  const waiting = pending || pendingCommand || stopping;
  const Icon = waiting ? LoaderCircle : running ? Square : Play;
  return <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label}
    className={`${stockWorkerCommandClass(running)} ${styles.command}`} data-icon-only={iconOnly}>
    <Icon aria-hidden="true" size={18} className={waiting ? "animate-spin motion-reduce:animate-none" : ""} />
    {!iconOnly && <span aria-hidden="true" className={styles.commandLabel}>{label}</span>}
  </button>;
}
