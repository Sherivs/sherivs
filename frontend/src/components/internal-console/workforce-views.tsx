/**
 * Presentational workforce views (ENGINE-12, ADR-090). Pure rendering of the view-model:
 * no console context, no data access, no actions.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import {
  PANEL_TITLES,
  buildRoster,
  type AgentDashboard,
  type RosterRow,
  type RosterView,
} from "@/lib/internal-console/workforce-view";
import { ConsoleNotice } from "./console-primitives";

const money = (minor: number) => `${(minor / 100).toLocaleString("en-US")} (major units)`;

function RosterCard({ row }: { row: RosterRow }) {
  return (
    <Link
      to={CONSOLE_PATHS.workforceAgent(row.code) as never}
      className="sherivs-console-row"
      data-testid={`workforce-agent-${row.code}`}
    >
      <strong>
        {row.codename} · {row.title}
      </strong>
      <small>{row.mission}</small>
      <small>
        Accountable: {row.accountable} · Reports to: {row.supervisor} · Highest tier:{" "}
        {row.highestTier} · {row.capabilityCount} capabilities ({row.gatedCount} need approval) ·
        Mode: shadow ·{" "}
        {row.binding === "bound" ? "Wired to the engine" : "Defined, not yet wired to the engine"}
      </small>
    </Link>
  );
}

export function WorkforceRosterView({ roster = buildRoster() }: { roster?: RosterView }) {
  return (
    <section className="sherivs-console-card" data-testid="console-workforce">
      <p className="sherivs-console-page-kicker">AI Workforce</p>
      <h1>AI workforce</h1>
      <p>
        {roster.total} agents: {roster.boundCount} wired to the engine and{" "}
        {roster.definitionOnlyCount} defined but not yet wired. Every agent starts in shadow mode
        and earns autonomy from evaluations. Money, deploys, secrets, access and public posts always
        need the sheriff.
      </p>
      {roster.rosterProblems.length > 0 ? (
        <ConsoleNotice tone="warning">
          The roster check reports {roster.rosterProblems.length} problem
          {roster.rosterProblems.length === 1 ? "" : "s"}: {roster.rosterProblems.join("; ")}
        </ConsoleNotice>
      ) : (
        <ConsoleNotice>
          Roster check passed: one owner for every high-impact capability, a clear supervision line,
          and an independent audit agent.
        </ConsoleNotice>
      )}
      {roster.groups.map((group) => (
        <div key={group.tier} style={{ marginTop: "1.25rem" }}>
          <h2>{group.title}</h2>
          <div className="sherivs-console-list">
            {group.rows.map((row) => (
              <RosterCard key={row.code} row={row} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <ConsoleNotice tone="info">{reason}</ConsoleNotice>;
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`panel-${id}`}
      data-testid={`panel-${id}`}
      style={{ marginTop: "1.5rem" }}
    >
      <h2 id={`panel-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

const WORKBENCH_TITLES = {
  console: "Command console",
  queue: "Work queue",
  feed: "Activity feed",
  board: "Board",
  ledger: "Ledger",
} as const;

function WorkspacePanels({ workspace }: { workspace: NonNullable<AgentDashboard["workspace"]> }) {
  const w = workspace;
  return (
    <>
      <Panel id="workspace" title="Workspace: what it can reach">
        <p>
          {w.reachesOrganizationRows
            ? "This agent can read some organization rows, only under the rule shown on each line."
            : "This agent never reads an organization's content. It works on platform records, aggregated figures and its own records."}
        </p>
        <div className="sherivs-console-list">
          {w.scopes.map((sc) => (
            <div
              key={sc.resource}
              className="sherivs-console-row"
              data-testid={`workspace-scope-${sc.resource}`}
            >
              <strong>{sc.resource}</strong>
              <small>
                {sc.access} · {sc.rowRule}
                {sc.grantMaxMinutes !== null
                  ? ` (grant up to ${sc.grantMaxMinutes} minutes)`
                  : ""}{" "}
                · Up to {sc.sensitivity} · {sc.purpose}
              </small>
            </div>
          ))}
        </div>
      </Panel>
      <Panel id="boundaries" title="Hard boundaries">
        <ul>
          {w.boundaries.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </Panel>
      <Panel id="workbench" title="Workbench layout">
        <div className="sherivs-console-list">
          <div className="sherivs-console-row">
            <strong>
              {WORKBENCH_TITLES[w.workbench.workbench]}: {w.workbench.headline}
            </strong>
            <small>When there is nothing to do: {w.workbench.emptyState}</small>
          </div>
          {w.workbench.queues.map((q) => (
            <div key={q.id} className="sherivs-console-row">
              <strong>{q.title}</strong>
              <small>Reads {q.source}</small>
            </div>
          ))}
          <div className="sherivs-console-row">
            <strong>Quick actions</strong>
            <small>{w.workbench.quickActions.map((a) => a.label).join(" · ")}</small>
          </div>
        </div>
      </Panel>
    </>
  );
}

export function AgentDashboardView({ dashboard }: { dashboard: AgentDashboard }) {
  const d = dashboard;
  const shown = new Set(d.panels);
  return (
    <section className="sherivs-console-card" data-testid={`console-agent-${d.code}`}>
      <p className="sherivs-console-page-kicker">
        <Link to={CONSOLE_PATHS.workforce as never}>AI Workforce</Link>
      </p>
      <h1>
        {d.codename} · {d.title}
      </h1>
      <p>
        {d.binding === "bound"
          ? "Wired to the engine. Read-only view: nothing on this page changes the agent."
          : "Defined only: its platform roles are a proposal and it is not wired to the engine yet. Read-only view."}
      </p>

      {shown.has("charter") ? (
        <Panel id="charter" title={PANEL_TITLES.charter}>
          <p>{d.charter.mission}</p>
          <div className="sherivs-console-list">
            <div className="sherivs-console-row">
              <strong>{d.charter.tier}</strong>
              <small>
                Accountable role: {d.charter.accountable} · Reports to: {d.charter.supervisor} ·
                Pack version {d.charter.packVersion} · Reviewed every {d.charter.reviewCadenceDays}{" "}
                days by {d.charter.reviewer}
              </small>
            </div>
          </div>
        </Panel>
      ) : null}

      {shown.has("context") ? (
        <Panel id="context" title={PANEL_TITLES.context}>
          <div className="sherivs-console-list">
            <div className="sherivs-console-row">
              <strong>Memory</strong>
              <small>
                Domains: {d.context.domains.join(", ")} · Up to {d.context.maxSensitivity} ·
                Retained {d.context.retentionDays} days · Never shared across tenants
              </small>
            </div>
            <div className="sherivs-console-row">
              <strong>Model use</strong>
              <small>
                Purposes: {d.context.modelPurposes.join(", ")} · Context ceiling{" "}
                {d.context.contextCeiling} ·{" "}
                {d.context.seesCustomerContent
                  ? "May see customer content"
                  : "Does not see customer content"}
              </small>
            </div>
          </div>
        </Panel>
      ) : null}

      {shown.has("permissions") ? (
        <Panel id="permissions" title={PANEL_TITLES.permissions}>
          <p>Permissions: {d.permissions.granted.join(", ")}</p>
          <table className="sherivs-console-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Tier</th>
                <th scope="col">Autonomy ceiling</th>
                <th scope="col">Duty</th>
                <th scope="col">Connector</th>
                <th scope="col">Approver</th>
                <th scope="col">Approval action</th>
                <th scope="col">Evaluation</th>
              </tr>
            </thead>
            <tbody>
              {d.permissions.capabilities.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.title}
                    <br />
                    <small>{c.id}</small>
                  </th>
                  <td>{c.tier}</td>
                  <td>{c.autonomy}</td>
                  <td>{c.duty}</td>
                  <td>{c.connector ?? "None"}</td>
                  <td>{c.approver ?? "None needed"}</td>
                  <td>
                    {c.approvalAction ??
                      (c.tier === "T0" || c.tier === "T1" ? "None needed" : "Not defined yet")}
                  </td>
                  <td>
                    {c.evalSuite
                      ? `${c.evalSuite} (${Math.round((c.evalBar ?? 0) * 100)}% to pass)`
                      : "None needed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      {shown.has("autonomy") ? (
        <Panel id="autonomy" title={PANEL_TITLES.autonomy}>
          <p>Current level: shadow. {d.autonomy.note}</p>
        </Panel>
      ) : null}

      {shown.has("budget") ? (
        <Panel id="budget" title={PANEL_TITLES.budget}>
          <p>
            Daily limits: {d.budget.dailyActions} actions · {d.budget.dailyModelCalls} model calls ·
            cost cap {money(d.budget.dailyCostCapMinor)}
          </p>
          <Unavailable reason={`Used today: ${d.budget.used.reason}`} />
        </Panel>
      ) : null}

      {shown.has("proposals") ? (
        <Panel id="proposals" title={PANEL_TITLES.proposals}>
          {d.proposals.routes.length === 0 ? (
            <p>This agent has no capability that needs approval.</p>
          ) : (
            <div className="sherivs-console-list">
              {d.proposals.routes.map((r) => (
                <div key={r.capabilityId} className="sherivs-console-row">
                  <strong>{r.capabilityId}</strong>
                  <small>
                    Approved by: {r.approver} · Approval action: {r.action ?? "not defined yet"}
                  </small>
                </div>
              ))}
            </div>
          )}
          <Unavailable reason={`Recorded proposals: ${d.proposals.recorded.reason}`} />
        </Panel>
      ) : null}

      {shown.has("runs") ? (
        <Panel id="runs" title={PANEL_TITLES.runs}>
          <div className="sherivs-console-list">
            {d.runs.playbooks.map((p) => (
              <div key={p.id} className="sherivs-console-row">
                <strong>{p.title}</strong>
                <small>
                  Wakes on {p.wakeOn.join(", ")} · Steps: {p.steps.join(" → ")} · At most{" "}
                  {p.maxRunsPerDay} runs a day
                </small>
              </div>
            ))}
          </div>
          <Unavailable reason={`Recorded runs: ${d.runs.recorded.reason}`} />
        </Panel>
      ) : null}

      {shown.has("handoffs") ? (
        <Panel id="handoffs" title={PANEL_TITLES.handoffs}>
          {d.handoffs.length === 0 ? (
            <p>This agent hands nothing off to other agents.</p>
          ) : (
            <div className="sherivs-console-list">
              {d.handoffs.map((h) => (
                <div key={`${h.to}-${h.kind}`} className="sherivs-console-row">
                  <strong>
                    {h.kind} → {h.to}
                  </strong>
                  <small>{h.when}</small>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {shown.has("slos") ? (
        <Panel id="slos" title={PANEL_TITLES.slos}>
          <div className="sherivs-console-list">
            {d.slos.targets.map((s) => (
              <div key={s.id} className="sherivs-console-row">
                <strong>{s.metric}</strong>
                <small>
                  Target {s.target} {s.unit} · {s.window} · starting value awaiting owner approval
                </small>
              </div>
            ))}
          </div>
          <Unavailable reason={`Measured: ${d.slos.measured.reason}`} />
        </Panel>
      ) : null}

      {shown.has("safety") ? (
        <Panel id="safety" title={PANEL_TITLES.safety}>
          <div className="sherivs-console-list">
            <div className="sherivs-console-row">
              <strong>Oversight</strong>
              <small>{d.safety.independentOversight}</small>
            </div>
            <div className="sherivs-console-row">
              <strong>Pause scope</strong>
              <small>
                Pausing affects: {d.safety.killScope}. Pausing is not available from this page.
              </small>
            </div>
            {d.safety.t3Rules.map((r) => (
              <div key={r.capabilityId} className="sherivs-console-row">
                <strong>{r.capabilityId}</strong>
                <small>
                  {r.rule === "owner"
                    ? "This agent owns the request; the sheriff decides with a passkey."
                    : "This agent may only ask the agent that owns the request."}
                </small>
              </div>
            ))}
            <div className="sherivs-console-row">
              <strong>Never autonomous</strong>
              <small>{d.safety.neverAutonomous.join(", ")}</small>
            </div>
          </div>
        </Panel>
      ) : null}

      {d.workspace ? <WorkspacePanels workspace={d.workspace} /> : null}
    </section>
  );
}
