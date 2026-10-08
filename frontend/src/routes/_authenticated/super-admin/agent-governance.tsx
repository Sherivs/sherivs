import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import { agentGovernanceReport } from "@/lib/agent-governance-report";

/**
 * Phase 07 — AI Agent System: the governance surface.
 *
 * "Agents are execution entities; domain phases remain owners of domain truth."
 * This page states the rules the agent system enforces, names the module and suite
 * behind each one, and shows the result of exercising the agent state machines —
 * a failing check is displayed as failing.
 */
export const Route = createFileRoute("/_authenticated/super-admin/agent-governance")({
  component: AgentGovernancePage,
  head: () => ({ meta: [{ title: "Agent governance — Sherivs" }] }),
});

function AgentGovernancePage() {
  const report = agentGovernanceReport();

  return (
    <PortalPage
      title="Agent governance"
      subtitle="What the agent system enforces today, and the checks that prove it — agents are principals, not authorities."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">
          Self-check: {report.passed}/{report.checks.length} passed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.healthy
            ? "Both agent state machines behaved as their contracts require."
            : `Failing: ${report.failingChecks.join(", ")}`}
        </p>
        <ul className="mt-4 space-y-2">
          {report.checks.map((check) => (
            <li key={check.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {check.ok ? "✓" : "✗"} {check.id}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{check.proves}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{check.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Task lifecycle</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.states.length} states, {report.declaredTransitions} declared transitions.
        </p>
        <p className="mt-3 text-sm">{report.states.join(" → ")}</p>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Enforced rules</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Rule</th>
              <th className="py-2">Enforced by</th>
              <th className="py-2">Proved by</th>
            </tr>
          </thead>
          <tbody>
            {report.rules.map((rule) => (
              <tr key={rule.id} className="border-t border-border">
                <td className="py-2">{rule.rule}</td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">
                  {rule.enforcedBy}
                </td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">
                  {rule.provedBy}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PortalPage>
  );
}
