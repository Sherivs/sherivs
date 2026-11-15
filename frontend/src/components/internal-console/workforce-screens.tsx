/**
 * Workforce console screens (ENGINE-12, ADR-090): capability-gated wrappers around the
 * presentational views. Read-only; no action here changes an agent.
 */
import { Link } from "@tanstack/react-router";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { buildAgentDashboard, canViewWorkforce } from "@/lib/internal-console/workforce-view";
import { useConsole } from "./console-shell";
import { AgentDashboardView, WorkforceRosterView } from "./workforce-views";

function Restricted() {
  return (
    <section className="sherivs-console-card" data-testid="console-workforce-restricted">
      <p className="sherivs-console-page-kicker">AI Workforce</p>
      <h1>AI workforce</h1>
      <p>The workforce view is limited to operations and audit staff.</p>
    </section>
  );
}

export function ConsoleWorkforceRoster() {
  const { overview } = useConsole();
  if (!overview) return <section className="sherivs-console-card">Loading workforce…</section>;
  if (!canViewWorkforce(overview.viewer)) return <Restricted />;
  return <WorkforceRosterView />;
}

export function ConsoleAgentDashboard({ code }: { code: string }) {
  const { overview } = useConsole();
  if (!overview) return <section className="sherivs-console-card">Loading agent…</section>;
  if (!canViewWorkforce(overview.viewer)) return <Restricted />;
  const dashboard = buildAgentDashboard(code);
  if (!dashboard) {
    return (
      <section className="sherivs-console-card" data-testid="console-agent-missing">
        <p className="sherivs-console-page-kicker">AI Workforce</p>
        <h1>Agent not found</h1>
        <p>
          No agent has the code {code}.{" "}
          <Link to={CONSOLE_PATHS.workforce as never}>Back to the roster</Link>
        </p>
      </section>
    );
  }
  return <AgentDashboardView dashboard={dashboard} />;
}
