/**
 * WF-12: workflow limits, wallet caps and retention (ADR-124), opened from the workspace shell at
 * /home/s/workflow-limits.
 *
 * Lazy-loaded from section-screen.tsx so the /home bundle does not grow. This screen only asks and
 * explains. The bounds, the safe minimums, who may change anything and the dry-run-before-purge rule
 * are decided and enforced by the database; the screen shows counts and codes, never row contents.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import {
  LIMIT_ACTION_KINDS,
  LIMIT_LABELS,
  LIMIT_NUMBER_KEYS,
  REFUSAL_LABELS,
  RETENTION_COUNT_LABELS,
  safeLimitMessage,
  type LimitNumberKey,
  type LimitsPatch,
  type LimitsView,
  type RetentionResult,
} from "@/lib/workflow/limits";
import {
  getWorkflowLimits,
  runWorkflowRetention,
  updateWorkflowLimits,
} from "@/lib/workflow-limits.functions";
import "./approval-inbox.css";

const GROUPS: ReadonlyArray<{ title: string; keys: readonly LimitNumberKey[] }> = [
  { title: "Quotas", keys: ["runs_per_day", "steps_per_run", "drafts_pending"] },
  { title: "Spend caps", keys: ["wallet_cap_kobo_per_day", "wallet_cap_kobo_per_run"] },
  {
    title: "Retention windows",
    keys: [
      "retention_outbox_days",
      "retention_draft_days",
      "retention_event_days",
      "retention_run_days",
      "retention_stepup_days",
      "retention_evidence_days",
    ],
  },
];

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}

export default function LimitsScreen() {
  const [view, setView] = useState<LimitsView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [hourly, setHourly] = useState<Record<string, string>>({});
  const [autoPurge, setAutoPurge] = useState(false);
  const [dry, setDry] = useState<RetentionResult | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getWorkflowLimits();
      setView(next);
      setDraft(Object.fromEntries(LIMIT_NUMBER_KEYS.map((k) => [k, String(next.limits[k])])));
      setHourly(
        Object.fromEntries(
          LIMIT_ACTION_KINDS.map((k) => [k, String(next.limits.actions_per_hour[k] ?? 0)]),
        ),
      );
      setAutoPurge(next.limits.retention_auto_purge);
      setError(null);
    } catch (err) {
      setError(safeLimitMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ceilingZero = (view?.wallet_cap_ceiling_kobo ?? 0) === 0;
  const canManage = view?.can_manage === true;

  async function save() {
    if (!view || busy) return;
    const patch: Record<string, unknown> = {};
    for (const key of LIMIT_NUMBER_KEYS) {
      if (ceilingZero && key.startsWith("wallet_cap")) continue;
      const next = Number(draft[key]);
      if (!Number.isInteger(next)) {
        setError(safeLimitMessage(new Error("")));
        return;
      }
      if (next !== view.limits[key]) patch[key] = next;
    }
    const kinds: Record<string, number> = {};
    for (const kind of LIMIT_ACTION_KINDS) {
      const next = Number(hourly[kind]);
      if (!Number.isInteger(next)) return;
      if (next !== (view.limits.actions_per_hour[kind] ?? 0)) kinds[kind] = next;
    }
    if (Object.keys(kinds).length > 0) patch.actions_per_hour = kinds;
    if (autoPurge !== view.limits.retention_auto_purge) patch.retention_auto_purge = autoPurge;
    if (Object.keys(patch).length === 0) {
      setNotice("Nothing to save.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateWorkflowLimits({ data: patch as LimitsPatch });
      setNotice("Saved. The change is recorded in the audit trail.");
      setDry(null);
      setConfirmPurge(false);
      await load();
    } catch (err) {
      setError(safeLimitMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function retention(dryRun: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runWorkflowRetention({
        data: { dryRun, dryRunId: dryRun ? null : (dry?.run_id ?? null) },
      });
      if (result.outcome === "refused") {
        setNotice(
          result.refusal_code === "legal_hold"
            ? "A legal hold is active, so nothing can be purged. Nothing was deleted."
            : "The run was refused. Nothing was deleted.",
        );
        setDry(null);
      } else if (dryRun) {
        setDry(result);
        setNotice("Dry run complete. Nothing was deleted. Review the counts below.");
      } else {
        setDry(null);
        setNotice("Purge complete. The counts are recorded in the audit trail.");
      }
      setConfirmPurge(false);
      await load();
    } catch (err) {
      setError(safeLimitMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const total = dry ? Object.values(dry.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <section className="wf-inbox" aria-labelledby="wf-limits-title">
      <header className="wf-inbox-heading">
        <div>
          <p className="wf-inbox-eyebrow">WORKFLOWS</p>
          <h1 id="wf-limits-title">Limits and retention</h1>
          <p className="wf-inbox-subtitle">
            How much work your workflows may do, what they may spend, and how long their history is
            kept. Limits stop work before it starts. Nothing here sends a message or moves money.{" "}
            <Link to={APP_SHELL_HOME}>Back to home</Link>
          </p>
        </div>
        <button
          type="button"
          className="wf-inbox-button"
          onClick={() => void load()}
          aria-label="Refresh limits"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div aria-live="polite" className="wf-inbox-live">
        {notice ? <p className="wf-inbox-notice">{notice}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="wf-inbox-error">
          {error}
        </p>
      ) : null}
      {view === null && !error ? <p className="wf-inbox-empty">Loading limits…</p> : null}

      {view ? (
        <div className="wf-inbox-detail">
          {!view.settings_exist ? (
            <p className="wf-inbox-empty">
              Workflows have not been set up for this organisation yet, so limits cannot be saved.
            </p>
          ) : null}
          {!view.configured ? (
            <p className="wf-inbox-subtitle">
              Your organisation is using the platform defaults. Saving creates your own settings.
            </p>
          ) : null}

          <h2>Usage right now</h2>
          <ul aria-label="Usage">
            <li>
              Runs in the last 24 hours: {view.usage.runs_24h} of {view.limits.runs_per_day}
            </li>
            <li>
              Drafts waiting for review: {view.usage.drafts_pending} of {view.limits.drafts_pending}
            </li>
            {LIMIT_ACTION_KINDS.map((kind) => (
              <li key={kind}>
                {kind} actions in the last hour: {view.usage.actions_1h[kind] ?? 0} of{" "}
                {view.limits.actions_per_hour[kind] ?? 0}
              </li>
            ))}
          </ul>

          <h2>Refused in the last 24 hours</h2>
          {view.denials_24h.length === 0 ? (
            <p className="wf-inbox-empty">Nothing was refused.</p>
          ) : (
            <ul aria-label="Refusals">
              {view.denials_24h.map((d) => (
                <li key={`${d.limit}:${d.kind ?? ""}`}>
                  {d.denied} × {REFUSAL_LABELS[d.limit] ?? d.limit}
                  {d.kind ? ` (${d.kind})` : ""}
                </li>
              ))}
            </ul>
          )}

          {GROUPS.map((group) => (
            <fieldset key={group.title} disabled={!canManage || busy}>
              <legend>{group.title}</legend>
              {group.title === "Spend caps" && ceilingZero ? (
                <p className="wf-inbox-subtitle">
                  Spend caps stay at zero until a spend ceiling is decided. Email and in-app actions
                  cost nothing, and text and WhatsApp stay off until a price is decided.
                </p>
              ) : null}
              {group.keys.map((key) => (
                <label key={key} className="wf-inbox-field">
                  <span>{LIMIT_LABELS[key]}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={view.bounds[key]?.min ?? 0}
                    max={view.bounds[key]?.max ?? undefined}
                    value={draft[key] ?? ""}
                    disabled={ceilingZero && key.startsWith("wallet_cap")}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </fieldset>
          ))}

          <fieldset disabled={!canManage || busy}>
            <legend>Actions per hour, by kind</legend>
            {LIMIT_ACTION_KINDS.map((kind) => (
              <label key={kind} className="wf-inbox-field">
                <span>{kind}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={5000}
                  value={hourly[kind] ?? ""}
                  onChange={(e) => setHourly((prev) => ({ ...prev, [kind]: e.target.value }))}
                />
              </label>
            ))}
            <label className="wf-inbox-field">
              <span>Purge automatically once a day, within these windows</span>
              <input
                type="checkbox"
                checked={autoPurge}
                onChange={(e) => setAutoPurge(e.target.checked)}
              />
            </label>
          </fieldset>

          {canManage ? (
            <button
              type="button"
              className="wf-inbox-button"
              disabled={busy}
              onClick={() => void save()}
            >
              Save limits
            </button>
          ) : (
            <p className="wf-inbox-subtitle">
              You can view limits. Changing them needs permission to manage workflows.
            </p>
          )}

          <h2>Retention</h2>
          <p className="wf-inbox-subtitle">
            A purge removes only history past its window. Approvals that are still pending, runs
            that are still active and audit records are never removed. Run a dry run first: it
            counts what a purge would remove and deletes nothing.
          </p>
          {view.last_retention ? (
            <p className="wf-inbox-subtitle">
              Last run: {view.last_retention.mode === "dry_run" ? "dry run" : "purge"}
              {view.last_retention.outcome === "refused" ? " (refused)" : ""},{" "}
              {when(view.last_retention.at)}
              {view.last_retention.trigger === "scheduler" ? ", automatic" : ""}.
            </p>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="wf-inbox-button"
              disabled={busy}
              onClick={() => void retention(true)}
            >
              Run a dry run
            </button>
          ) : null}
          {dry ? (
            <div aria-label="Dry run result">
              <ul>
                {Object.entries(dry.counts).map(([k, n]) => (
                  <li key={k}>
                    {RETENTION_COUNT_LABELS[k] ?? k}: {n}
                  </li>
                ))}
              </ul>
              {dry.truncated ? (
                <p className="wf-inbox-subtitle">
                  This pass is capped, so more will remain after it. Run it again to continue.
                </p>
              ) : null}
              {canManage && total > 0 ? (
                confirmPurge ? (
                  <div role="group" aria-label="Confirm purge">
                    <p>
                      This permanently deletes {total} records past their window. It cannot be
                      undone. Audit records stay.
                    </p>
                    <button
                      type="button"
                      className="wf-inbox-button"
                      disabled={busy}
                      onClick={() => void retention(false)}
                    >
                      Yes, purge now
                    </button>
                    <button
                      type="button"
                      className="wf-inbox-button"
                      onClick={() => setConfirmPurge(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="wf-inbox-button"
                    onClick={() => setConfirmPurge(true)}
                  >
                    Purge what the dry run found
                  </button>
                )
              ) : null}
              {total === 0 ? <p className="wf-inbox-empty">Nothing is past its window.</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
