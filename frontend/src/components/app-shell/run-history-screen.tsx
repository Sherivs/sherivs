/**
 * WF-08: tenant run history, retry and cancel (ADR-123), opened from the workspace shell at
 * /home/s/workflow-runs.
 *
 * Lazy-loaded from section-screen.tsx so the /home bundle does not grow. This screen only asks and
 * explains. Who may cancel or retry, which steps may be retried and what a retry may never do are
 * decided by the database, which also redacts everything it returns: this screen shows counts,
 * codes and statuses, never recipients, message text, parameters or provider output.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Square } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import {
  RETRY_BLOCKER_MESSAGES,
  RUN_CONTROL_REASONS,
  RUN_HISTORY_FILTERS,
  RUN_REASON_LABELS,
  safeRunMessage,
  type RunControlReason,
  type RunDetail,
  type RunHistoryFilter,
  type RunListItem,
  type RunStep,
} from "@/lib/workflow/run-history";
import {
  cancelWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  retryWorkflowStep,
} from "@/lib/workflow-run-history.functions";
import "./approval-inbox.css";

function when(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}

const FILTER_LABEL: Record<RunHistoryFilter, string> = {
  all: "All runs",
  active: "In progress",
  failed: "Failed",
  succeeded: "Succeeded",
  cancelled: "Cancelled",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  pending: "Not started",
  claimed: "Starting",
  skipped: "Skipped",
  dead: "Failed for good",
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function codeLabel(code: string | null | undefined): string {
  return code ? code.replace(/[._]/g, " ") : "";
}

type Pending =
  { kind: "cancel"; runId: string } | { kind: "retry"; stepId: string; stepKey: string } | null;

export default function RunHistoryScreen() {
  const [filter, setFilter] = useState<RunHistoryFilter>("all");
  const [items, setItems] = useState<RunListItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState<RunControlReason>("operator_request");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async (next: RunHistoryFilter, before?: string) => {
    try {
      const page = await listWorkflowRuns({
        data: { filter: next, ...(before ? { before } : {}) },
      });
      setItems((prev) => (before && prev ? [...prev, ...page.items] : page.items));
      setHasMore(page.has_more);
      setError(null);
    } catch (err) {
      if (!before) setItems([]);
      setError(safeRunMessage(err));
    }
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    try {
      setDetail(await getWorkflowRun({ data: { runId } }));
      setError(null);
    } catch (err) {
      setDetail(null);
      setError(safeRunMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadList(filter);
  }, [filter, loadList]);

  useEffect(() => {
    setPending(null);
    if (selected) void loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail]);

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (pending.kind === "cancel") {
        const result = await cancelWorkflowRun({ data: { runId: pending.runId, reason } });
        setNotice(
          result.replayed
            ? "This run was already cancelled."
            : "Cancelled. Anything still waiting in this run was stopped.",
        );
        await Promise.all([loadList(filter), loadDetail(pending.runId)]);
      } else {
        const result = await retryWorkflowStep({ data: { stepId: pending.stepId, reason } });
        setNotice(
          result.replayed
            ? "This step was already retried. Showing that run."
            : "Retry started as a new run. The original run is unchanged.",
        );
        await loadList(filter);
        setSelected(result.run_id);
      }
      setPending(null);
    } catch (err) {
      setError(safeRunMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function renderStepRetry(step: RunStep, d: RunDetail) {
    if (step.status !== "dead" || !step.retry) return null;
    if (step.retry.retry_run_id) {
      return (
        <button
          type="button"
          className="wf-inbox-button"
          onClick={() => setSelected(step.retry?.retry_run_id ?? null)}
        >
          Open the retry run
        </button>
      );
    }
    if (step.retry.blockers.length > 0) {
      return (
        <ul className="wf-inbox-votes" aria-label={`Why ${step.step_key} cannot be retried`}>
          {step.retry.blockers.map((b) => (
            <li key={b}>{RETRY_BLOCKER_MESSAGES[b]}</li>
          ))}
        </ul>
      );
    }
    if (!d.permissions.can_retry) return null;
    return (
      <button
        type="button"
        className="wf-inbox-button"
        onClick={() => setPending({ kind: "retry", stepId: step.step_id, stepKey: step.step_key })}
      >
        <RotateCcw size={16} aria-hidden="true" />
        Retry this step
      </button>
    );
  }

  return (
    <section className="wf-inbox" aria-labelledby="wf-runs-title">
      <header className="wf-inbox-heading">
        <div>
          <p className="wf-inbox-eyebrow">WORKFLOWS</p>
          <h1 id="wf-runs-title">Run history</h1>
          <p className="wf-inbox-subtitle">
            What your workflows did, step by step. Names, addresses and message text are never shown
            here. A retry starts a new run and never sends anything on its own.{" "}
            <Link to={APP_SHELL_HOME}>Back to home</Link>
          </p>
        </div>
        <button
          type="button"
          className="wf-inbox-button"
          onClick={() => {
            void loadList(filter);
            if (selected) void loadDetail(selected);
          }}
          aria-label="Refresh run history"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div className="wf-inbox-tabs" role="tablist" aria-label="Run filter">
        {RUN_HISTORY_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "is-active" : ""}
            onClick={() => {
              setSelected(null);
              setFilter(key);
            }}
          >
            {FILTER_LABEL[key]}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="wf-inbox-live">
        {notice ? <p className="wf-inbox-notice">{notice}</p> : null}
      </div>
      {error ? (
        <p role="alert" id="wf-runs-error" className="wf-inbox-error">
          {error}
        </p>
      ) : null}

      <div className="wf-inbox-layout">
        <ul className="wf-inbox-list" aria-label="Runs">
          {items === null ? <li className="wf-inbox-empty">Loading runs…</li> : null}
          {items !== null && items.length === 0 ? (
            <li className="wf-inbox-empty">No runs match this filter.</li>
          ) : null}
          {(items ?? []).map((item) => (
            <li key={item.run_id}>
              <button
                type="button"
                className={`wf-inbox-row${selected === item.run_id ? " is-selected" : ""}`}
                onClick={() => setSelected(item.run_id)}
                aria-current={selected === item.run_id ? "true" : undefined}
              >
                <span className="wf-inbox-row-title">{item.workflow_key}</span>
                <span className="wf-inbox-row-meta">
                  {statusLabel(item.status)} · {when(item.created_at)}
                </span>
                <span className="wf-inbox-row-tags">
                  {item.trigger_event_type ? (
                    <span className="wf-inbox-tag">{item.trigger_event_type}</span>
                  ) : null}
                  {item.retry_of_run_id ? (
                    <span className="wf-inbox-tag">Retry {item.retry_generation} of 3</span>
                  ) : null}
                  {item.open_approvals > 0 ? (
                    <span className="wf-inbox-tag is-high">
                      {item.open_approvals} waiting for approval
                    </span>
                  ) : null}
                  {item.has_dead_step ? (
                    <span className="wf-inbox-tag is-high">A step failed</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
          {hasMore && items && items.length > 0 ? (
            <li>
              <button
                type="button"
                className="wf-inbox-button"
                onClick={() => void loadList(filter, items[items.length - 1]?.created_at)}
              >
                Show older runs
              </button>
            </li>
          ) : null}
        </ul>

        <article className="wf-inbox-detail" aria-live="polite">
          {!selected ? (
            <p className="wf-inbox-empty">Choose a run to see what happened.</p>
          ) : !detail ? (
            <p className="wf-inbox-empty">{error ? "" : "Loading…"}</p>
          ) : (
            <>
              <h2>{detail.run.workflow_key}</h2>
              <p className="wf-inbox-meta">
                {statusLabel(detail.run.status)}
                {detail.run.error_code ? ` · ${codeLabel(detail.run.error_code)}` : ""} · version{" "}
                {detail.run.version} · started {when(detail.run.started_at)}
                {detail.run.finished_at ? ` · finished ${when(detail.run.finished_at)}` : ""}
              </p>
              {detail.run.retry_of_run_id ? (
                <p className="wf-inbox-banner">
                  This is retry {detail.run.retry_generation} of 3.{" "}
                  <button
                    type="button"
                    className="wf-inbox-button"
                    onClick={() => setSelected(detail.run.retry_of_run_id)}
                  >
                    Open the original run
                  </button>
                </p>
              ) : null}
              {!detail.permissions.workflows_enabled ? (
                <p className="wf-inbox-banner is-blocked">
                  Workflows are switched off for this organisation. History stays readable, and
                  retry is unavailable.
                </p>
              ) : null}

              {detail.permissions.can_cancel ? (
                <div className="wf-inbox-actions">
                  <button
                    type="button"
                    className="wf-inbox-button is-danger"
                    onClick={() => setPending({ kind: "cancel", runId: detail.run.run_id })}
                  >
                    <Square size={16} aria-hidden="true" />
                    Cancel this run
                  </button>
                </div>
              ) : null}

              {pending ? (
                <div className="wf-inbox-section" role="group" aria-label="Confirm">
                  <h3>
                    {pending.kind === "cancel"
                      ? "Cancel this run?"
                      : `Retry the step "${pending.stepKey}"?`}
                  </h3>
                  <p className="wf-inbox-meta">
                    {pending.kind === "cancel"
                      ? "Anything waiting for approval or a send will be stopped. This cannot be undone."
                      : "A new run starts at this step. If it needs approval it will ask again."}
                  </p>
                  <label className="wf-inbox-note">
                    <span>Reason</span>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value as RunControlReason)}
                      aria-describedby={error ? "wf-runs-error" : undefined}
                      style={{ minHeight: 44 }}
                    >
                      {RUN_CONTROL_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {RUN_REASON_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="wf-inbox-actions">
                    <button
                      type="button"
                      className="wf-inbox-button is-primary"
                      disabled={busy}
                      onClick={() => void confirm()}
                    >
                      {busy ? "Working…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      className="wf-inbox-button"
                      disabled={busy}
                      onClick={() => setPending(null)}
                    >
                      Keep it as it is
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="wf-inbox-section">
                <h3>Steps</h3>
                <ol className="wf-inbox-votes">
                  {detail.steps.map((step) => (
                    <li key={step.step_id}>
                      <strong>{step.step_key}</strong> ({step.kind}) · {statusLabel(step.status)}
                      {step.attempt > 0 ? ` · attempt ${step.attempt} of ${step.max_attempts}` : ""}
                      {step.error_code ? ` · ${codeLabel(step.error_code)}` : ""}
                      <div>{renderStepRetry(step, detail)}</div>
                    </li>
                  ))}
                </ol>
              </div>

              {detail.approvals.length > 0 ? (
                <div className="wf-inbox-section">
                  <h3>Approvals</h3>
                  <ul className="wf-inbox-votes">
                    {detail.approvals.map((a) => (
                      <li key={a.approval_id}>
                        {a.risk === "high" ? "High risk" : "Normal risk"} · {a.status} ·{" "}
                        {a.approvals} of {a.required} approvals
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {detail.drafts.length > 0 || detail.outbox.length > 0 ? (
                <div className="wf-inbox-section">
                  <h3>Drafted and recorded actions</h3>
                  <ul className="wf-inbox-votes">
                    {detail.drafts.map((dr) => (
                      <li key={dr.draft_id}>
                        Draft · {dr.kind.replace(/_/g, " ")} · {dr.status} · {dr.recipient_count}{" "}
                        recipient{dr.recipient_count === 1 ? "" : "s"}
                      </li>
                    ))}
                    {detail.outbox.map((o) => (
                      <li key={o.outbox_id}>
                        Recorded in the test outbox · {o.kind.replace(/_/g, " ")} ·{" "}
                        {o.recipient_count} recipient{o.recipient_count === 1 ? "" : "s"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="wf-inbox-section">
                <h3>Timeline</h3>
                <ol className="wf-inbox-votes">
                  {detail.events.map((ev) => (
                    <li key={ev.event_id}>
                      {when(ev.at)} · {codeLabel(ev.kind)}
                      {ev.detail.error_code ? ` · ${codeLabel(ev.detail.error_code)}` : ""}
                      {ev.detail.reason_code ? ` · ${codeLabel(ev.detail.reason_code)}` : ""}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
