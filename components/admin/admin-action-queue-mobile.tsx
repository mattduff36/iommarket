"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Ban, Bug, ClipboardList, Clock, Star, type LucideIcon } from "lucide-react";
import type { AdminActionQueueItem } from "./admin-action-queue";
import styles from "./admin-action-queue-mobile.module.css";

const QUEUES: Record<string, { icon: LucideIcon; label: string }> = {
  "/admin/listings": { icon: Clock, label: "Listings" },
  "/admin/reports": { icon: AlertTriangle, label: "Reports" },
  "/admin/reviews": { icon: Star, label: "Reviews" },
  "/admin/cancellations": { icon: Ban, label: "Cancels" },
  "/admin/monitoring": { icon: Bug, label: "Issues" },
  "/admin/trade/applications": { icon: ClipboardList, label: "Applications" },
  "/admin/trade/reports": { icon: AlertTriangle, label: "Reports" },
  "/admin/trade/listings": { icon: Clock, label: "Listings" },
};

function queueMeta(entry: { href: string; label: string }) {
  return QUEUES[entry.href.split("?")[0]] ?? { icon: Clock, label: entry.label };
}

export function AdminActionQueueMobile({ items }: {
  items: Omit<AdminActionQueueItem, "icon">[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const panelId = useId();
  const item = selected === null ? null : items[selected];
  const tone = (entry: typeof items[number]) => entry.count === 0 ? "clear" : entry.tone;

  return (
    <div className={`${styles.queue} mb-6 sm:hidden`} data-open={Boolean(item)}>
      <div className={styles.rail} role="group" aria-label="Admin action queues">
        {items.map((entry, index) => {
          const { icon: Icon, label } = queueMeta(entry);
          return (
            <button
              key={entry.href}
              type="button"
              id={`${panelId}-${index}`}
              className={styles.status}
              data-tone={tone(entry)}
              aria-label={`${entry.count.toLocaleString()} ${entry.label}`}
              aria-pressed={selected === index}
              aria-expanded={selected === index}
              aria-controls={panelId}
              onClick={() => setSelected(index)}
            >
              <Icon aria-hidden size={15} />
              <span className={styles.count}>{entry.count.toLocaleString()}</span>
              <span className={styles.label}>{label}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.panel} id={panelId} aria-hidden={!item}>
        {item && (
          <section
            key={item.href}
            className={styles.details}
            data-tone={tone(item)}
            aria-labelledby={`${panelId}-heading`}
            aria-live="polite"
          >
            <h3 id={`${panelId}-heading`} className={styles.heading}>
              <span>{item.count.toLocaleString()}</span> {item.label}
            </h3>
            <p className={styles.description}>
              {item.count === 0 ? "All clear — nothing needs attention in this queue." : item.subtitle}
            </p>
            <Link className={styles.action} href={item.href}>
              Open {queueMeta(item).label.toLowerCase()} queue
              <ArrowUpRight aria-hidden size={15} />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
