/**
 * AIN-05: the agent console (ADR-129), opened from the workspace shell at /home/s/agent-console.
 *
 * Lazy-loaded from section-screen.tsx so the /home bundle does not grow. Three tabs: the agents and the level each has
 * earned, the memory proposals waiting for a person, and the screened outputs waiting for review. This screen only asks
 * and explains. Who may see or decide, and every rule about levels, memory and review, are the database's. It shows
 * codes, counts and the short memory value a manager may see; never the text of a screened output, and it never
 * promotes (raising a level is a founder decision made on evidence).
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import {
  AGENT_LEVEL_LABELS,
  AUTONOMY_LEVELS,
  CONSOLE_REASONS,
  CONSOLE_REASON_LABELS,
  DEMOTE_TARGETS,
  MEMORY_FILTERS,
  SAFETY_FILTERS,
  safeConsoleMessage,
  type AgentConsole,
  type AutonomyLevel,
  type ConsoleAgent,
  type ConsoleReason,
  type MemoryItem,
  type SafetyItem,
} from "@/lib/workflow/agent-console";
import {
  decideConsoleMemory,
  demoteConsoleAgent,
  listConsoleMemory,
  listConsoleSafety,
  loadAgentConsole,
  retireConsoleMemory,
  reviewConsoleSafety,
} from "@/lib/workflow-agent-console.functions";
import "./approval-inbox.css";

type Tab = "agents" | "memory" | "review";
type MemoryFilter = (typeof MEMORY_FILTERS)[number];
type SafetyFilter = (typeof SAFETY_FILTERS)[number];

const MEMORY_LABEL: Record<MemoryFilter, string> = { proposed: "Waiting", active: "In use", all: "All" };
const SAFETY_LABEL: Record<SafetyFilter, string> = {
  pending: "Waiting",
  blocked: "Blocked",
  decided: "Decided",
  all: "All",
};

function when(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}
function words(code: string): string {
  return code.replace(/[._:]/g, " ");
}

type PendingAction =
  | { kind: "demote"; agent: ConsoleAgent; to: (typeof DEMOTE_TARGETS)[number] }
  | { kind: "review"; item: SafetyItem; decision: "cleared" | "rejected" }
  | { kind: "retire"; item: MemoryItem }
  | null;

export default function AgentConsoleScreen() {
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<AgentConsole | null>(null);
  const [memFilter, setMemFilter] = useState<MemoryFilter>("proposed");
  const [memory, setMemory] = useState<MemoryItem[] | null>(null);
  const [memMore, setMemMore] = useState(false);
  const [safeFilter, setSafeFilter] = useState<SafetyFilter>("pending");
  const [safety, setSafety] = useState<SafetyItem[] | null>(null);
  const [safeMore, setSafeMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState<ConsoleReason>("quality_concern");
  const [busy, setBusy] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      setAgents(await loadAgentConsole());
      setError(null);
    } catch (err) {
      setAgents(null);
      setError(safeConsoleMessage(err));
    }
  }, []);

  const loadMemory = useCallback(async (status: MemoryFilter, before?: string, beforeId?: string) => {
    try {
      const page = await listConsoleMemory({
        data: { status, ...(before ? { before, ...(beforeId ? { beforeId } : {}) } : {}) },
      });
      setMemory((prev) => (before && prev ? [...prev, ...page.items] : page.items));
      setMemMore(page.has_more);
      setError(null);
    } catch (err) {
      if (!before) setMemory([]);
      setError(safeConsoleMessage(err));
    }
  }, []);

  const loadSafety = useCallback(async (filter: SafetyFilter, before?: string, beforeId?: string) => {
    try {
      const page = await listConsoleSafety({
        data: { filter, ...(before ? { before, ...(beforeId ? { beforeId } : {}) } : {}) },
      });
      setSafety((prev) => (before && prev ? [...prev, ...page.items] : page.items));
      setSafeMore(page.has_more);
      setError(null);
    } catch (err) {
      if (!before) setSafety([]);
      setError(safeConsoleMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);
  useEffect(() => {
    if (tab === "memory") void loadMemory(memFilter);
  }, [tab, memFilter, loadMemory]);
  useEffect(() => {
    if (tab === "review") void loadSafety(safeFilter);
  }, [tab, safeFilter, loadSafety]);

  async function decideMemory(item: MemoryItem, decision: "accept" | "reject") {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideConsoleMemory({ data: { itemId: item.item_id, decision } });
      setNotice(decision === "accept" ? "Accepted. It is now in use." : "Rejected. Its content was removed.");
      await loadMemory(memFilter);
    } catch (err) {
      setError(safeConsoleMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (pending.kind === "demote") {
        await demoteConsoleAgent({ data: { agentRef: pending.agent.agent_ref, toLevel: pending.to, reason } });
        setNotice("The level was lowered. It takes effect on the agent's next step.");
        await loadAgents();
      } else if (pending.kind === "review") {
        await reviewConsoleSafety({ data: { checkId: pending.item.check_id, decision: pending.decision, reason } });
        setNotice(pending.decision === "cleared" ? "Cleared." : "Rejected.");
        await loadSafety(safeFilter);
      } else {
        await retireConsoleMemory({ data: { itemId: pending.item.item_id } });
        setNotice("Retired. Its content was removed.");
        await loadMemory(memFilter);
      }
      setPending(null);
    } catch (err) {
      setError(safeConsoleMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function lowerTargets(a: ConsoleAgent) {
    const rank = AUTONOMY_LEVELS.indexOf(a.earned_level);
    return DEMOTE_TARGETS.filter((l) => AUTONOMY_LEVELS.indexOf(l) < rank);
  }

  const canManage = agents?.can_manage ?? false;
  const needsReason = pending?.kind === "demote" || pending?.kind === "review";

  return (
    <section className="wf-inbox" aria-labelledby="ain-console-title">
      <header className="wf-inbox-heading">
        <div>
          <p className="wf-inbox-eyebrow">AGENTS</p>
          <h1 id="ain-console-title">Agent console</h1>
          <p className="wf-inbox-subtitle">
            Which agents work for your organisation, what each may do, and what is waiting for a person. The text of a
            screened output is never shown here. Raising an agent&apos;s level is a founder decision.{" "}
            <Link to={APP_SHELL_HOME}>Back to home</Link>
          </p>
        </div>
        <button
          type="button"
          className="wf-inbox-button"
          onClick={() => {
            void loadAgents();
            if (tab === "memory") void loadMemory(memFilter);
            if (tab === "review") void loadSafety(safeFilter);
          }}
          aria-label="Refresh the agent console"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </header>

      {agents && !agents.ai_route_approved ? (
        <p role="status" className="wf-inbox-notice" data-testid="ai-route-banner">
          The AI route is not approved yet, so agents are not running. Levels and reviews can still be set up.
        </p>
      ) : null}

      <div className="wf-inbox-tabs" role="tablist" aria-label="Console section">
        {(
          [
            ["agents", "Agents"],
            ["memory", "Memory"],
            ["review", "Output review"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-active" : ""}
            onClick={() => {
              setPending(null);
              setTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="wf-inbox-live">
        {notice ? <p className="wf-inbox-notice">{notice}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="wf-inbox-error">
          {error}
        </p>
      ) : null}

      {pending ? (
        <div role="alertdialog" aria-label="Confirm" className="wf-inbox-confirm">
          <p>
            {pending.kind === "demote"
              ? `Lower ${pending.agent.codename} to “${AGENT_LEVEL_LABELS[pending.to]}”? It will do less on its own until a founder raises it again.`
              : pending.kind === "review"
                ? pending.decision === "cleared"
                  ? "Clear this output so it can be used?"
                  : "Reject this output so it is never used?"
                : "Retire this memory item? Its content is removed and this cannot be undone."}
          </p>
          {needsReason ? (
            <label>
              Reason
              <select value={reason} onChange={(e) => setReason(e.target.value as ConsoleReason)}>
                {CONSOLE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CONSOLE_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div>
            <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void confirm()}>
              Confirm
            </button>
            <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {tab === "agents" ? (
        <ul className="wf-inbox-list" aria-label="Agents">
          {agents === null && !error ? <li className="wf-inbox-empty">Loading agents…</li> : null}
          {(agents?.agents ?? []).map((a) => (
            <li key={a.agent_ref} className="wf-inbox-row" data-testid="agent-row">
              <span className="wf-inbox-row-title">
                {a.codename} <small>({a.family === "org" ? "your organisation" : "platform"})</small>
              </span>
              <span className="wf-inbox-row-meta">
                {AGENT_LEVEL_LABELS[a.earned_level as AutonomyLevel]} · limit {AGENT_LEVEL_LABELS[a.ceiling]} ·{" "}
                {words(a.state)} · {a.steps_24h} steps in 24 hours
              </span>
              {a.next_level && a.bar ? (
                <span className="wf-inbox-row-meta">
                  Next: {AGENT_LEVEL_LABELS[a.next_level]}. Needs {a.bar.min_graded}+ graded cases,{" "}
                  {Math.round(a.bar.min_pass_rate * 100)}% passed, no critical failure, evaluated within{" "}
                  {a.bar.max_age_days} days.{" "}
                  {a.evidence
                    ? `Latest evaluation: ${a.evidence.passed}/${a.evidence.graded} passed, ${a.evidence.critical_failures} critical, ${a.evidence.age_days} days old, ${a.evidence.meets_bar ? "meets" : "does not meet"} the bar.`
                    : "No evaluation yet."}
                </span>
              ) : (
                <span className="wf-inbox-row-meta">No higher level is available to this agent.</span>
              )}
              {a.changes.length > 0 ? (
                <span className="wf-inbox-row-meta">
                  Recent changes:{" "}
                  {a.changes
                    .map((c) => `${words(c.kind)} to ${AGENT_LEVEL_LABELS[c.to]} (${when(c.at)})`)
                    .join("; ")}
                </span>
              ) : null}
              {canManage
                ? lowerTargets(a).map((to) => (
                    <button
                      key={to}
                      type="button"
                      className="wf-inbox-button"
                      onClick={() => setPending({ kind: "demote", agent: a, to })}
                    >
                      Lower to {AGENT_LEVEL_LABELS[to]}
                    </button>
                  ))
                : null}
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "memory" ? (
        <>
          <div className="wf-inbox-tabs" role="tablist" aria-label="Memory filter">
            {MEMORY_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={memFilter === key}
                className={memFilter === key ? "is-active" : ""}
                onClick={() => setMemFilter(key)}
              >
                {MEMORY_LABEL[key]}
              </button>
            ))}
          </div>
          <ul className="wf-inbox-list" aria-label="Memory">
            {memory === null ? <li className="wf-inbox-empty">Loading memory…</li> : null}
            {memory !== null && memory.length === 0 ? <li className="wf-inbox-empty">Nothing here.</li> : null}
            {(memory ?? []).map((m) => (
              <li key={m.item_id} className="wf-inbox-row" data-testid="memory-row">
                <span className="wf-inbox-row-title">{m.key}</span>
                <span className="wf-inbox-row-meta">
                  {m.status} · {m.source_kind === "agent" ? `proposed by ${m.source_agent ?? "an agent"}` : "written by a person"} ·{" "}
                  {words(m.scope_kind)} · {when(m.created_at)}
                  {m.expired ? " · expired" : ""}
                </span>
                {m.status !== "retired" ? <code className="wf-inbox-row-meta">{m.value}</code> : null}
                {m.status === "proposed" && !m.expired ? (
                  <>
                    <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void decideMemory(m, "accept")}>
                      Accept
                    </button>
                    <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void decideMemory(m, "reject")}>
                      Reject
                    </button>
                  </>
                ) : null}
                {m.status !== "retired" ? (
                  <button type="button" className="wf-inbox-button" onClick={() => setPending({ kind: "retire", item: m })}>
                    Retire
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {memMore && memory && memory.length > 0 ? (
            <button
              type="button"
              className="wf-inbox-button"
              onClick={() => {
                const last = memory[memory.length - 1];
                if (last) void loadMemory(memFilter, last.created_at, last.item_id);
              }}
            >
              Show more
            </button>
          ) : null}
        </>
      ) : null}

      {tab === "review" ? (
        <>
          <div className="wf-inbox-tabs" role="tablist" aria-label="Review filter">
            {SAFETY_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={safeFilter === key}
                className={safeFilter === key ? "is-active" : ""}
                onClick={() => setSafeFilter(key)}
              >
                {SAFETY_LABEL[key]}
              </button>
            ))}
          </div>
          <ul className="wf-inbox-list" aria-label="Screened outputs">
            {safety === null ? <li className="wf-inbox-empty">Loading…</li> : null}
            {safety !== null && safety.length === 0 ? <li className="wf-inbox-empty">Nothing here.</li> : null}
            {(safety ?? []).map((s) => (
              <li key={s.check_id} className="wf-inbox-row" data-testid="check-row">
                <span className="wf-inbox-row-title">
                  {words(s.step_key)} · {s.direction}
                </span>
                <span className="wf-inbox-row-meta">
                  {s.verdict}
                  {s.codes.length > 0 ? ` (${s.codes.map(words).join(", ")})` : ""} · {s.text_chars} characters ·{" "}
                  {when(s.created_at)}
                  {s.decision ? ` · ${s.decision} ${when(s.decided_at)}` : ""}
                </span>
                {s.started_by_me && s.verdict === "flagged" && !s.decision ? (
                  <span className="wf-inbox-row-meta">You started this run, so another person must review it.</span>
                ) : null}
                {s.can_review ? (
                  <>
                    <button type="button" className="wf-inbox-button" onClick={() => setPending({ kind: "review", item: s, decision: "cleared" })}>
                      Clear
                    </button>
                    <button type="button" className="wf-inbox-button" onClick={() => setPending({ kind: "review", item: s, decision: "rejected" })}>
                      Reject
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {safeMore && safety && safety.length > 0 ? (
            <button
              type="button"
              className="wf-inbox-button"
              onClick={() => {
                const last = safety[safety.length - 1];
                if (last) void loadSafety(safeFilter, last.created_at, last.check_id);
              }}
            >
              Show more
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
