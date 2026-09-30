import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import { buildFinancialIntelligenceReport } from "@/lib/financial-intelligence-report";

/**
 * Phase 13 — Payment, Billing & Financial Operating System (FinOS): the phase surface.
 *
 * Access is enforced by the platform's own authorization layers, not by this page: the route sits
 * behind the authenticated portal and the control plane's server-side gate. Nothing here declares a
 * role list, and nothing here hides a failure — every check is rendered with the observation that
 * produced it, and every gap the phase has not closed is named in the open.
 *
 * The vocabulary comes from the report itself, so the page cannot drift from the phase: what an
 * organization calls a charge, who owes it and who is paid is institutional data, and no single
 * institution is the default.
 */
export const Route = createFileRoute("/_authenticated/super-admin/financial-operations")({
  component: FinancialOperationsPage,
  head: () => ({ meta: [{ title: "Financial operations — CoreGrid" }] }),
});

function FinancialOperationsPage() {
  const report = buildFinancialIntelligenceReport();
  const failing = report.checks.filter((check) => !check.passed);

  return (
    <PortalPage
      title="Financial operations"
      subtitle="Money that requires proof: what this platform records about what is owed, billed, paid, refunded and settled, the checks that prove it records it correctly, and what it cannot yet do."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">
          Self-check: {report.checks.length - report.totals.failedChecks}/{report.checks.length}{" "}
          checks passed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.totals.rules} claimed rules · {report.totals.modules} modules ·{" "}
          {report.totals.organizations} organizations' vocabulary · {report.totals.declaredGaps}{" "}
          declared gaps
        </p>
        <p className="mt-2 text-sm">
          {failing.length === 0
            ? "Every financial engine behaved as its contract requires, against real money records."
            : `Failing: ${failing.map((check) => check.id).join(", ")}`}
        </p>
        <ul className="mt-4 space-y-2">
          {report.checks.map((check) => (
            <li key={check.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {check.passed ? "✓" : "✗"} {check.id} — {check.module}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{check.observed}</p>
            </li>
          ))}
        </ul>
        {report.rulesWithoutExecutedCheck.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Rules carried by suites rather than by an executed check here:{" "}
            {report.rulesWithoutExecutedCheck.join(", ")}.
          </p>
        )}
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">
          Split payments: one collection, many beneficiaries
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A split is created once and is immutable. Its legs must sum exactly to the gross amount,
          each leg settles and reconciles on its own evidence, provider fees belong to the leg whose
          route produced them, and a refund spreads pro rata across the legs that received money.
          The platform's own fee is a leg like any other — there is no privileged path — and a
          beneficiary that cannot be paid stays visible as an unresolved leg instead of quietly
          handing its share to someone else.
        </p>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">
          The same capability, in each organization's own words
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing in the engine assumes one institution's process. Currency, jurisdiction, tax
          rules, charge reasons, discount categories and provider choices are institutional data.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Organization</th>
              <th className="py-2">What is billed</th>
              <th className="py-2">Who owes</th>
              <th className="py-2">Who is paid</th>
              <th className="py-2">The split</th>
            </tr>
          </thead>
          <tbody>
            {report.vocabulary.map((entry) => (
              <tr key={entry.organization} className="border-t border-border">
                <td className="py-2 font-medium">{entry.organization}</td>
                <td className="py-2">{entry.whatIsBilled}</td>
                <td className="py-2">{entry.whoOwes}</td>
                <td className="py-2">{entry.whoIsPaid}</td>
                <td className="py-2 text-muted-foreground">{entry.splitStory}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">The rules this phase enforces</h2>
        <ul className="mt-3 space-y-2">
          {report.rules.map((rule) => (
            <li key={rule.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {rule.id}{" "}
                <span className="font-normal text-muted-foreground">
                  · blueprint {rule.blueprint}
                </span>
              </p>
              <p className="mt-1 text-sm">{rule.statement}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {rule.module} · {rule.suite}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Not done yet — declared, not implied</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          These are the parts of the financial operating system that do not exist yet. Each names
          what would close it, so a later review can verify rather than trust.
        </p>
        <ul className="mt-3 space-y-2">
          {report.gaps.map((gap) => (
            <li key={gap.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {gap.id} — {gap.area}
              </p>
              <p className="mt-1 text-sm">{gap.statement}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Closes when: {gap.closesWhen} (owner: {gap.owner})
              </p>
            </li>
          ))}
        </ul>
      </section>
    </PortalPage>
  );
}
