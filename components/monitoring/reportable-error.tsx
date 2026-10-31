"use client";

import { createContext, createElement, useContext, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cleanReportedMessage, sendUserIssueReport, type UserIssueReport } from "@/lib/monitoring/user-report";

const InsideError = createContext(false);
const reports = new Map<string, { payload: UserIssueReport; result?: string; pending?: Promise<string> }>();
type Props = HTMLAttributes<HTMLElement> & {
  as?: "p" | "span" | "div" | "section";
  "data-reportable-error"?: string;
};

/** React owns the complete error, including its controls, during server rendering and hydration. */
export function ReportableError({ as = "div", children, ...props }: Props) {
  const nested = useContext(InsideError);
  const root = useRef<HTMLElement>(null);
  const [stored, setStatus] = useState({ content: null as ReactNode, pending: false, reference: "", failure: "" });
  const status = stored.content === children ? stored : { pending: false, reference: "", failure: "" };
  const enabled = !nested && props["data-reportable-error"] !== "false" &&
    (props["data-reportable-error"] === "true" || props.role === "alert" || /(?:^|\s)text-(?:text-error|neon-red-400)(?:\s|$)/.test(props.className ?? ""));

  async function report() {
    if (!root.current || status.pending) return;
    const copy = root.current.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-issue-report-controls],input,textarea,select,button,a,script,style,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
    const message = cleanReportedMessage((copy.textContent ?? "").replace(/\s+/g, " "));
    const route = window.location.pathname;
    const key = `${route}:${message}`;
    let entry = reports.get(key);
    if (!entry) {
      const supportReference = /\breference ([A-Za-z0-9_-]{8,80})\b/.exec(message)?.[1];
      entry = { payload: { reportId: crypto.randomUUID(), message, route, ...(supportReference ? { supportReference } : {}) } };
      // Retain a bounded click history, without collecting errors that were never reported.
      if (reports.size >= 200) reports.delete(reports.keys().next().value!);
      reports.set(key, entry);
    }
    setStatus({ content: children, pending: true, reference: "", failure: "" });
    try {
      entry.pending ??= entry.result ? Promise.resolve(entry.result) : sendUserIssueReport(entry.payload);
      const reference = await entry.pending;
      reports.set(key, { ...entry, result: reference, pending: undefined });
      setStatus({ content: children, pending: false, reference, failure: "" });
    } catch (error) {
      reports.set(key, { ...entry, pending: undefined });
      const failure = error instanceof Error && error.message === "Please wait before reporting another issue."
        ? error.message : "Could not send the report. Try again.";
      setStatus({ content: children, pending: false, reference: "", failure });
    }
  }

  return createElement(as, { ...props, ref: root, "data-reportable-error": enabled ? "true" : props["data-reportable-error"] },
    <InsideError.Provider value={nested || enabled}>
      {children}
      {enabled && <span data-issue-report-controls="true" className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal">
        <button type="button" disabled={status.pending || Boolean(status.reference)} onClick={() => { void report(); }}
          title="Send this error to the site administrators"
          className="rounded px-1 py-1 underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 disabled:opacity-60">
          {status.pending ? "Sending…" : status.reference ? "Reported" : "Report issue"}
        </button>
        <span role={status.reference || status.failure ? "status" : undefined}>{status.reference ? `Reported. Reference ${status.reference}.` : status.failure}</span>
      </span>}
    </InsideError.Provider>);
}
