import { Link } from "@tanstack/react-router";
import { CONSOLE_HEALTH_LABELS, type ConsoleHealthState } from "@/lib/internal-console/status";
import { quickActionsFor } from "@/lib/internal-console/roles";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { allowedHrefsFrom, readRecentResources } from "@/lib/internal-console/recent";
import { SCHOLAR_RUNTIME_CONTRACT } from "@/lib/internal-console/runtime-contract";
import { workspaceTypeLabel } from "@/lib/internal-console/workspaces";
import { useConsole } from "./console-shell";
import { ConsoleNotice } from "./console-primitives";

function StatusBadge({ status }: { status: ConsoleHealthState }) {
  return (
    <span className={`sherivs-console-status is-${status}`}>
      <i />
      {CONSOLE_HEALTH_LABELS[status]}
    </span>
  );
}

export function ConsoleHomeScreen() {
  const { overview, error } = useConsole();
  if (!overview) {
    return (
      <section className="sherivs-console-card">
        <p className="sherivs-console-page-kicker">Home</p>
        <h1>Internal Platform Operations</h1>
        <p>{error ? error : "Loading operational status…"}</p>
        {error ? (
          <ConsoleNotice tone="error">The homepage could not be retrieved.</ConsoleNotice>
        ) : null}
      </section>
    );
  }

  const viewer = {
    isSuperAdmin: overview.viewer.isSuperAdmin,
    capabilities: new Set(overview.viewer.capabilities),
  };
  const canReadOrgs =
    viewer.capabilities.has("platform.tenants.read") ||
    viewer.capabilities.has("platform.operations.read");
  const actions = quickActionsFor(viewer);
  const allowed = allowedHrefsFrom([
    ...overview.workspaces,
    { href: CONSOLE_PATHS.home },
    { href: CONSOLE_PATHS.scholar },
    { href: CONSOLE_PATHS.help },
    ...(canReadOrgs ? [{ href: CONSOLE_PATHS.organizations }] : []),
    ...(viewer.isSuperAdmin || viewer.capabilities.has("platform.staff.read")
      ? [{ href: CONSOLE_PATHS.team }]
      : []),
  ]);
  const recent = overview.recent.length ? overview.recent : readRecentResources(allowed);
  const measured = overview.metrics.filter((metric) => metric.available);
  const unmeasured = overview.metrics.filter((metric) => !metric.available);
  const healthCards = overview.health.cards.filter(
    (card) =>
      card.key === "platform" ||
      card.key === "scholar" ||
      card.key === "database" ||
      card.key === "auth",
  );
  const attention = overview.attention.filter((item) => {
    if (
      item.href === CONSOLE_PATHS.organizations ||
      item.href.startsWith(`${CONSOLE_PATHS.organizations}/`)
    ) {
      return canReadOrgs;
    }
    return true;
  });

  return (
    <>
      <section className="sherivs-console-card sherivs-console-welcome" data-testid="console-home">
        <p className="sherivs-console-page-kicker">Home</p>
        <p>Welcome back, {overview.viewer.name}</p>
        <h1>Internal Platform Operations</h1>
        <p>
          {overview.context.organization} · {overview.viewer.presentationLabel} ·{" "}
          {overview.context.workspace}
        </p>
        <p>
          Environment: {overview.context.environment}
          {overview.context.environmentSource !== "not configured"
            ? ` (${overview.context.environmentSource})`
            : " — environment is not configured"}
        </p>
        {attention.length === 0 ? <p>No verified items need attention right now.</p> : null}
      </section>

      {canReadOrgs && overview.organizationMetrics.available ? (
        <section className="sherivs-console-card" data-testid="console-org-pipeline">
          <h2>Onboarding pipeline</h2>
          <p>
            {overview.organizationMetrics.onboarding ?? 0} onboarding ·{" "}
            {overview.organizationMetrics.active ?? 0} active ·{" "}
            {overview.organizationMetrics.suspended ?? 0} suspended ·{" "}
            {overview.organizationMetrics.failedProvisioning ?? 0} failed provisioning. Source:{" "}
            {overview.organizationMetrics.source}.
          </p>
          <div className="sherivs-console-actions" style={{ marginTop: "0.8rem" }}>
            <Link
              to={CONSOLE_PATHS.organizations as never}
              className="sherivs-console-btn secondary"
            >
              Open organizations
            </Link>
          </div>
        </section>
      ) : canReadOrgs ? (
        <section className="sherivs-console-card">
          <h2>Onboarding pipeline</h2>
          <p className="sherivs-console-empty">
            Organization lifecycle storage is not configured, so pipeline counts are not shown.
          </p>
        </section>
      ) : null}

      {attention.length ? (
        <section className="sherivs-console-card">
          <h2>Attention required</h2>
          <div className="sherivs-console-list">
            {attention.map((item) => (
              <Link key={item.id} to={item.href as never} className="sherivs-console-row">
                <strong>
                  {item.severity.toUpperCase()} · {item.title}
                </strong>
                <small>{item.description}</small>
                <small>
                  {item.resource} · {item.nextAction} · {new Date(item.detectedAt).toLocaleString()}
                </small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="sherivs-console-card">
        <h2>Platform health</h2>
        <p>{overview.health.caveat}</p>
        <div className="sherivs-console-grid" style={{ marginTop: "0.9rem" }}>
          {healthCards.map((card) => (
            <Link key={card.key} to={card.href as never} className="sherivs-console-row">
              <strong>{card.name}</strong>
              <StatusBadge status={card.status} />
              <small>{card.detail}</small>
              <small>
                Source: {card.source}
                {card.lastCheck
                  ? ` · Updated ${new Date(card.lastCheck).toLocaleString()}`
                  : " · No successful check"}
              </small>
            </Link>
          ))}
        </div>
      </section>

      <div className="sherivs-console-split">
        <section className="sherivs-console-card">
          <h2>My work</h2>
          {canReadOrgs && overview.assignments.length ? (
            <div className="sherivs-console-list">
              {overview.assignments.map((assignment) => (
                <Link
                  key={assignment.id}
                  to={CONSOLE_PATHS.organization(assignment.organizationId) as never}
                  className="sherivs-console-row"
                >
                  <strong>{assignment.staffName ?? assignment.organizationId}</strong>
                  <small>
                    {assignment.assignmentType} · {assignment.status}
                  </small>
                </Link>
              ))}
            </div>
          ) : (
            <p className="sherivs-console-empty">
              No organization assignments are recorded for you. Sherivs V1 does not include a
              general task system, so this section stays empty rather than showing decorative work.
            </p>
          )}
        </section>
        <section className="sherivs-console-card">
          <h2>Sherivs Scholar</h2>
          <p>{SCHOLAR_RUNTIME_CONTRACT.description}</p>
          <div className="sherivs-console-actions" style={{ marginTop: "0.8rem" }}>
            <Link to={CONSOLE_PATHS.scholar as never} className="sherivs-console-btn">
              Open runtime
            </Link>
          </div>
        </section>
      </div>

      <section className="sherivs-console-card">
        <h2>Quick actions</h2>
        <div className="sherivs-console-actions" style={{ marginTop: "0.8rem" }}>
          {actions.map((action) => (
            <Link
              key={action.key}
              to={action.href as never}
              className="sherivs-console-btn secondary"
            >
              {action.label}
            </Link>
          ))}
          {actions.length === 0 ? (
            <p className="sherivs-console-empty">No permitted actions for this role.</p>
          ) : null}
        </div>
      </section>

      <section className="sherivs-console-card">
        <h2>My workspaces</h2>
        <div className="sherivs-console-list">
          {overview.workspaces.map((workspace) => (
            <Link key={workspace.id} to={workspace.href as never} className="sherivs-console-row">
              <strong>{workspace.name}</strong>
              <small>
                {workspaceTypeLabel(workspace.type)} · {workspace.access}
                {workspace.source === "derived" ? " · compatibility directory" : ""}
              </small>
            </Link>
          ))}
        </div>
      </section>

      <div className="sherivs-console-split">
        <section className="sherivs-console-card">
          <h2>Recent activity</h2>
          {overview.activity.length ? (
            <div className="sherivs-console-list">
              {overview.activity.map((item) => (
                <div key={item.id} className="sherivs-console-row">
                  <strong>{item.description}</strong>
                  <small>
                    {item.actor ?? "Unknown actor"} · {item.outcome} ·{" "}
                    {new Date(item.at).toLocaleString()}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="sherivs-console-empty">
              {viewer.capabilities.has("platform.audit.read")
                ? "No recent administrative events."
                : "Administrative activity is limited to authorized roles."}
            </p>
          )}
        </section>
        <section className="sherivs-console-card">
          <h2>Recently accessed</h2>
          {recent.length ? (
            <div className="sherivs-console-list">
              {recent.map((item) => (
                <Link key={item.id} to={item.href as never} className="sherivs-console-row">
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind} · {new Date(item.at).toLocaleString()}
                  </small>
                </Link>
              ))}
            </div>
          ) : (
            <p className="sherivs-console-empty">
              Recently accessed resources appear here after you open an authorized page.
            </p>
          )}
        </section>
      </div>

      <section className="sherivs-console-card">
        <h2>Operational metrics</h2>
        {measured.length ? (
          <div className="sherivs-console-grid" style={{ marginTop: "0.9rem" }}>
            {measured.map((metric) => (
              <div key={metric.key} className="sherivs-console-metric sherivs-console-row">
                <span>{metric.name}</span>
                <strong>
                  {metric.value} {metric.unit}
                </strong>
                <small>
                  {metric.window} · {metric.source}
                  {metric.updatedAt
                    ? ` · Updated ${new Date(metric.updatedAt).toLocaleString()}`
                    : ""}
                </small>
                <small>{metric.definition}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="sherivs-console-empty">No measured operational metrics are available.</p>
        )}
        {unmeasured.length ? (
          <p>Not collected in V1: {unmeasured.map((metric) => metric.name).join(", ")}.</p>
        ) : null}
      </section>
    </>
  );
}
