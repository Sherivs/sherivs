import type { ReactNode } from "react";
import {
  STAFF_STATUS_LABELS,
  type ConsoleStaffPresentationStatus,
} from "@/lib/internal-console/overview";

export function ConsoleAtmosphere({ children }: { children: ReactNode }) {
  return (
    <div className="sherivs-console">
      <div className="sherivs-console-orbs" aria-hidden="true">
        <span className="sherivs-console-orb sherivs-console-orb-cyan" />
        <span className="sherivs-console-orb sherivs-console-orb-blue" />
        <span className="sherivs-console-orb sherivs-console-orb-violet" />
      </div>
      <div className="sherivs-console-stage">{children}</div>
    </div>
  );
}

export function ConsoleLoadingState({ message }: { message: string }) {
  return (
    <ConsoleAtmosphere>
      <section
        className="sherivs-console-card"
        data-testid="console-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p className="sherivs-console-page-kicker">Internal Console</p>
        <h1>Sherivs</h1>
        <p>{message}</p>
      </section>
    </ConsoleAtmosphere>
  );
}

export function ConsoleNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <p className={`sherivs-console-notice is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function StaffStatusBadge({ status }: { status: ConsoleStaffPresentationStatus }) {
  return <span className={`sherivs-console-pill is-${status}`}>{STAFF_STATUS_LABELS[status]}</span>;
}

export function ConfirmAction({
  question,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sherivs-console-confirm" role="alertdialog" aria-label={question}>
      <p>{question}</p>
      <div className="sherivs-console-actions">
        <button type="button" className="sherivs-console-btn" disabled={busy} onClick={onConfirm}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          className="sherivs-console-btn secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
