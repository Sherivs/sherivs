import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import { runtimeSelfReport } from "@/lib/runtime-self-report";

/**
 * Phase 05 — Core Application Runtime: the runtime's own workspace projection.
 *
 * Every value on this page comes from exercising the shipped runtime contracts
 * (`runtime-self-report.ts`) — a failing self-check is shown as failing, so this
 * page can never claim a health the runtime does not have. It sits in the
 * super-admin area, so the platform's own operators see the execution fabric.
 */
export const Route = createFileRoute("/_authenticated/super-admin/runtime-contracts")({
  component: RuntimeContractsPage,
  head: () => ({ meta: [{ title: "Runtime contracts — Sherivs" }] }),
});

function RuntimeContractsPage() {
  const report = runtimeSelfReport();

  return (
    <PortalPage
      title="Runtime contracts"
      subtitle="The execution fabric's own state machines, exercised on load — not described."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">
          Self-check: {report.passed}/{report.checks.length} passed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.healthy
            ? "Every execution state machine behaved as its contract requires."
            : `Failing: ${report.failingChecks.join(", ")}`}
        </p>
        <ul className="mt-4 space-y-3">
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
        <h2 className="font-display text-lg font-bold">Execution subsystems</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Phase 05 executes capabilities; it never becomes their owner.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Subsystem</th>
              <th className="py-2">Owns</th>
              <th className="py-2">States</th>
            </tr>
          </thead>
          <tbody>
            {report.subsystems.map((subsystem) => (
              <tr key={subsystem.id} className="border-t border-border">
                <td className="py-2 font-mono text-xs">{subsystem.id}</td>
                <td className="py-2">{subsystem.owns}</td>
                <td className="py-2 text-xs text-muted-foreground">
                  {subsystem.states.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PortalPage>
  );
}
